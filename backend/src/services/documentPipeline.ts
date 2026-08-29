import { randomUUID } from 'node:crypto'
import { putObject } from '../storage/index.js'
import { createDocument, updateDocumentStatus, updatePageLayout } from '../db/documents.js'
import { createChunks } from '../db/chunks.js'
import { getVoice, listVoiceRows, upsertVoice } from '../db/voices.js'
import { mapWithConcurrency } from '../lib/concurrency.js'
import { activeProvider, listVoices as listProviderVoices } from './tts.js'
import { regionRank } from './ttsTypes.js'
import { splitIntoChunks } from './chunking.js'
import { processDocument } from './generation.js'
import { extractPdfLayout } from './pdfLayout.js'
import type { DocumentRow, SourceType } from '../db/types.js'
import type { VoiceRow } from '../db/types.js'
import type { PdfLayout } from './pdfLayout.js'

export class NoTextExtractedError extends Error {
  constructor() {
    super('No text could be extracted from this file.')
  }
}

/**
 * Resolves a voice by DB id, or falls back to the first known voice for the
 * active TTS provider, syncing from that provider if none are stored yet.
 *
 * Every lookup is provider-scoped: `voices` accumulates rows from whichever
 * backends have been used, and a provider voice ID is meaningless to a
 * different provider (an ElevenLabs UUID passed to Speechify is not a voice,
 * it is a 400). So a requested voice belonging to another provider is
 * deliberately ignored rather than honored.
 */
export async function resolveVoice(voiceId: string | undefined): Promise<VoiceRow> {
  const provider = activeProvider()

  if (voiceId) {
    const voice = await getVoice(voiceId)
    if (voice && voice.provider === provider) return voice
  }

  const existing = await listVoiceRows()
  const forProvider = existing
    .filter((voice) => voice.provider === provider)
    .sort((a, b) => regionRank(a.locale) - regionRank(b.locale))
  if (forProvider.length > 0) return forProvider[0]

  const remoteVoices = await listProviderVoices()
  const synced = await mapWithConcurrency(remoteVoices, 8, (v) =>
    upsertVoice({
      provider,
      providerVoiceId: v.providerVoiceId,
      displayName: v.displayName,
      locale: v.locale ?? null,
      previewAudioUrl: v.previewAudioUrl ?? null,
    }),
  )
  if (synced.length === 0) throw new Error(`No ${provider} voices available to assign to this document.`)
  return synced[0]
}

export interface IngestInput {
  title: string
  sourceType: SourceType
  fileBuffer: Buffer
  fileContentType: string
  extractedText: string
  ownerId: string
  voiceId?: string
  /** PDF-only: per-word bounding boxes from pdfLayout.ts, stored on the document for the Page view reader. */
  pageLayout?: Pick<PdfLayout, 'pages' | 'words'>
}

/**
 * Shared pipeline for every import path (PDF/DOCX/TXT/EPUB upload, book-page
 * scan, URL import): store the original and create the document row, then
 * return immediately. Chunking and TTS generation happen in the
 * background, not before responding — with the Studio API, `createChunks`
 * alone is N sequential network round-trips, and blocking the HTTP
 * response on that plus a full TTS call routinely took well past what
 * proxies/browsers treat as reasonable, with zero progress feedback in the
 * meantime. The frontend already polls `GET /documents/:id` while
 * `status === 'processing'` (see `useReaderPlayback.ts`) — that's what
 * surfaces real progress, not a single opaque wait, and it also means the
 * document exists (and is visible in the library) the instant it's
 * created rather than only once the entire pipeline finishes.
 */
export async function ingestDocument(input: IngestInput): Promise<DocumentRow> {
  const text = input.extractedText.trim()
  if (!text) throw new NoTextExtractedError()

  const voice = await resolveVoice(input.voiceId)

  const originalFileKey = `originals/${randomUUID()}`
  await putObject(originalFileKey, input.fileBuffer, input.fileContentType)

  const document = await createDocument({
    title: input.title,
    sourceType: input.sourceType,
    originalFileKey,
    voiceId: voice.id,
    ownerId: input.ownerId,
    pageLayout: input.pageLayout ?? null,
  })

  generateDocumentInBackground(document.id, text, voice.providerVoiceId)

  return document
}

function generateDocumentInBackground(documentId: string, text: string, voiceProviderVoiceId: string): void {
  void (async () => {
    try {
      const chunkSplits = splitIntoChunks(text)
      const chunks = await createChunks(documentId, chunkSplits)
      await processDocument(documentId, voiceProviderVoiceId, chunks)
    } catch (err) {
      console.error(`Document generation failed (document ${documentId}):`, err)
      await updateDocumentStatus(documentId, 'error', 'Failed to process this document.').catch(() => {})
    }
  })()
}

export interface IngestPdfInput {
  title: string
  fileBuffer: Buffer
  fileContentType: string
  ownerId: string
  voiceId?: string
}

/**
 * PDF-specific ingest path: unlike the other formats, PDF layout extraction
 * (services/pdfLayout.ts — per-page pdfjs parsing, column/section reading-
 * order detection, and word bounding boxes) can legitimately take well past
 * what a reverse proxy or browser treats as a reasonable request timeout for
 * a long or layout-heavy document. It used to run synchronously before this
 * function even returned, which meant a large PDF import could leave the
 * client hanging on the upload request indefinitely with the document never
 * even appearing. Extraction now runs in the background alongside chunking
 * and TTS, the same way those already do — the document exists (status
 * 'processing', pageLayout null) the instant this returns, and the frontend
 * poll picks up pageLayout/chunks once each stage finishes.
 */
export async function ingestPdfDocument(input: IngestPdfInput): Promise<DocumentRow> {
  const voice = await resolveVoice(input.voiceId)

  const originalFileKey = `originals/${randomUUID()}`
  await putObject(originalFileKey, input.fileBuffer, input.fileContentType)

  const document = await createDocument({
    title: input.title,
    sourceType: 'pdf',
    originalFileKey,
    voiceId: voice.id,
    ownerId: input.ownerId,
    pageLayout: null,
  })

  runPdfPipelineInBackground(document.id, input.fileBuffer, voice.providerVoiceId)

  return document
}

function runPdfPipelineInBackground(documentId: string, fileBuffer: Buffer, voiceProviderVoiceId: string): void {
  void (async () => {
    try {
      const { text, pages, words } = await extractPdfLayout(fileBuffer)
      const trimmed = text.trim()
      if (!trimmed) {
        await updateDocumentStatus(documentId, 'error', 'No text could be extracted from this document.')
        return
      }

      await updatePageLayout(documentId, { pages, words })

      const chunkSplits = splitIntoChunks(trimmed)
      const chunks = await createChunks(documentId, chunkSplits)
      await processDocument(documentId, voiceProviderVoiceId, chunks)
    } catch (err) {
      console.error(`PDF extraction failed (document ${documentId}):`, err)
      await updateDocumentStatus(documentId, 'error', 'Failed to process this PDF.').catch(() => {})
    }
  })()
}

