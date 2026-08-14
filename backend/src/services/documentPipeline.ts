import { randomUUID } from 'node:crypto'
import { putObject } from '../storage/index.js'
import { createDocument, updateDocumentStatus } from '../db/documents.js'
import { createChunks } from '../db/chunks.js'
import { getVoice, listVoiceRows, upsertVoice } from '../db/voices.js'
import { listVoices as listElevenLabsVoices } from './elevenlabs.js'
import { splitIntoChunks } from './chunking.js'
import { processDocument } from './generation.js'
import type { DocumentRow, SourceType } from '../db/types.js'
import type { VoiceRow } from '../db/types.js'

export class NoTextExtractedError extends Error {
  constructor() {
    super('No text could be extracted from this file.')
  }
}

/** Resolves a voice by DB id, or falls back to the first known voice, syncing from ElevenLabs if the table is empty. */
export async function resolveVoice(voiceId: string | undefined): Promise<VoiceRow> {
  if (voiceId) {
    const voice = await getVoice(voiceId)
    if (voice) return voice
  }

  const existing = await listVoiceRows()
  if (existing.length > 0) return existing[0]

  const remoteVoices = await listElevenLabsVoices()
  const synced = await Promise.all(
    remoteVoices.map((v) =>
      upsertVoice({ provider: 'elevenlabs', providerVoiceId: v.providerVoiceId, displayName: v.displayName }),
    ),
  )
  if (synced.length === 0) throw new Error('No ElevenLabs voices available to assign to this document.')
  return synced[0]
}

export interface IngestInput {
  title: string
  sourceType: SourceType
  fileBuffer: Buffer
  fileContentType: string
  extractedText: string
  voiceId?: string
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
  })

  generateDocumentInBackground(document.id, text, voice.providerVoiceId)

  return document
}

function generateDocumentInBackground(documentId: string, text: string, voiceProviderVoiceId: string): void {
  void (async () => {
    try {
      const chunkTexts = splitIntoChunks(text)
      const chunks = await createChunks(documentId, chunkTexts)
      await processDocument(documentId, voiceProviderVoiceId, chunks)
    } catch (err) {
      console.error(`Document generation failed (document ${documentId}):`, err)
      await updateDocumentStatus(documentId, 'error', 'Failed to process this document.').catch(() => {})
    }
  })()
}

