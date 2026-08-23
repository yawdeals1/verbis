import { synthesizeChunk } from './tts.js'
import { putObject } from '../storage/index.js'
import { markChunkError, markChunkReady } from '../db/chunks.js'
import { updateDocumentStatus } from '../db/documents.js'
import type { ChunkRow } from '../db/types.js'

function audioKeyFor(documentId: string, sequenceIndex: number): string {
  return `audio/${documentId}/${sequenceIndex}.mp3`
}

/** Synthesizes one chunk's audio + timing and persists both. Throws on failure. */
export async function generateChunk(chunk: ChunkRow, voiceProviderVoiceId: string): Promise<void> {
  const { audioBuffer, timing, durationSeconds } = await synthesizeChunk(
    chunk.textContent,
    voiceProviderVoiceId,
  )
  const audioKey = audioKeyFor(chunk.documentId, chunk.sequenceIndex)
  await putObject(audioKey, audioBuffer, 'audio/mpeg')
  await markChunkReady(chunk.id, { audioKey, timingData: timing, durationSeconds })
}

/**
 * Generates every remaining chunk sequentially, without blocking the caller.
 * Playback only needs the first chunk to start (PRODUCT_PLAN.md §9 latency
 * target); the rest fill in while the user is already listening.
 */
export function generateRemainingChunksInBackground(
  documentId: string,
  voiceProviderVoiceId: string,
  chunks: ChunkRow[],
): void {
  void (async () => {
    for (const chunk of chunks) {
      try {
        await generateChunk(chunk, voiceProviderVoiceId)
      } catch (err) {
        console.error(`Chunk generation failed (document ${documentId}, chunk ${chunk.sequenceIndex}):`, err)
        await markChunkError(chunk.id)
      }
    }
  })()
}

/**
 * Generates the first chunk synchronously so the caller can respond once
 * playback is possible, then kicks off the rest in the background.
 */
export async function processDocument(documentId: string, voiceProviderVoiceId: string, chunks: ChunkRow[]): Promise<void> {
  if (chunks.length === 0) {
    await updateDocumentStatus(documentId, 'error', 'No text could be extracted from this document.')
    return
  }

  const [first, ...rest] = chunks
  try {
    await generateChunk(first, voiceProviderVoiceId)
  } catch (err) {
    console.error(`First-chunk generation failed (document ${documentId}):`, err)
    await markChunkError(first.id)
    await updateDocumentStatus(documentId, 'error', 'Audio generation failed for the first chunk.')
    return
  }

  await updateDocumentStatus(documentId, 'ready')
  generateRemainingChunksInBackground(documentId, voiceProviderVoiceId, rest)
}
