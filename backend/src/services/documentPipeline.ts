import { randomUUID } from 'node:crypto'
import { putObject } from '../storage/index.js'
import { createDocument, getDocument, updateDocumentStatus } from '../db/documents.js'
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
 * scan): store the original, chunk the text, generate the first chunk's
 * audio synchronously so the caller can start playback immediately, and
 * queue the rest in the background.
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

  const chunkTexts = splitIntoChunks(text)
  const chunks = await createChunks(document.id, chunkTexts)

  await processDocument(document.id, voice.providerVoiceId, chunks)

  const refreshed = await getDocument(document.id)
  return refreshed ?? document
}

export async function failDocument(documentId: string, message: string): Promise<void> {
  await updateDocumentStatus(documentId, 'error', message)
}
