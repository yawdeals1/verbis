import { synthesizeChunk } from './tts.js'
import { putObject } from '../storage/index.js'
import { markChunkError, markChunkReady } from '../db/chunks.js'
import { updateDocumentStatus } from '../db/documents.js'
import type { ChunkRow } from '../db/types.js'

function audioKeyFor(documentId: string, sequenceIndex: number): string {
  return `audio/${documentId}/${sequenceIndex}.mp3`
}

const MAX_SYNTHESIS_ATTEMPTS = 3
const MAX_LEAD_CHUNK_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 5_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Retries a chunk whose synthesis failed.
 *
 * Both backends are metered hosted APIs, so the failures worth retrying are
 * rate limits and transient 5xx/socket errors — a bad voice ID or malformed
 * text fails identically every time and just costs three attempts before the
 * caller sees it. Backoff grows so a 429 isn't answered by two more requests
 * inside the same window.
 */
async function synthesizeWithRetry(text: string, voiceProviderVoiceId: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await synthesizeChunk(text, voiceProviderVoiceId)
    } catch (err) {
      if (attempt >= MAX_SYNTHESIS_ATTEMPTS) throw err
      console.warn(
        `[tts] synthesis attempt ${attempt}/${MAX_SYNTHESIS_ATTEMPTS} failed, retrying:`,
        err instanceof Error ? err.message : err,
      )
      await sleep(RETRY_BASE_DELAY_MS * attempt)
    }
  }
}

/** Synthesizes one chunk's audio + timing and persists both. Throws on failure. */
export async function generateChunk(chunk: ChunkRow, voiceProviderVoiceId: string): Promise<void> {
  const { audioBuffer, timing, durationSeconds } = await synthesizeWithRetry(
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
 * Generates a chunk the caller can start playing, then kicks off the rest in
 * the background.
 *
 * Falls forward instead of failing the document when a lead chunk can't be
 * synthesized. Front matter — a table of contents, a bare heading list — is
 * both the least worth hearing and the most likely to break synthesis, and a
 * 52-chunk document is not unreadable because its contents page is. Chunks
 * that fail are left marked `error` so the reader skips them.
 */
export async function processDocument(documentId: string, voiceProviderVoiceId: string, chunks: ChunkRow[]): Promise<void> {
  if (chunks.length === 0) {
    await updateDocumentStatus(documentId, 'error', 'No text could be extracted from this document.')
    return
  }

  const leadLimit = Math.min(MAX_LEAD_CHUNK_ATTEMPTS, chunks.length)
  for (let index = 0; index < leadLimit; index++) {
    const chunk = chunks[index]
    try {
      await generateChunk(chunk, voiceProviderVoiceId)
    } catch (err) {
      console.error(`Lead chunk generation failed (document ${documentId}, chunk ${chunk.sequenceIndex}):`, err)
      await markChunkError(chunk.id)
      continue
    }

    await updateDocumentStatus(documentId, 'ready')
    generateRemainingChunksInBackground(documentId, voiceProviderVoiceId, chunks.slice(index + 1))
    return
  }

  await updateDocumentStatus(documentId, 'error', 'Audio generation failed for the opening chunks.')
}
