import { insertRow, listRows, updateRow } from './studioClient.js'
import type { TimingData } from '../types/timing.js'
import type { ChunkRow, ChunkStatus } from './types.js'
import type { ChunkSplit } from '../services/chunking.js'

const TABLE = 'chunks'

function mapRow(row: Record<string, unknown>): ChunkRow {
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    sequenceIndex: row.sequence_index as number,
    textContent: row.text_content as string,
    charStart: (row.char_start as number | null) ?? null,
    status: row.status as ChunkStatus,
    audioKey: (row.audio_key as string | null) ?? null,
    timingData: (row.timing_data as TimingData | null) ?? null,
    durationSeconds: row.duration_seconds === null || row.duration_seconds === undefined ? null : Number(row.duration_seconds),
  }
}

export async function createChunks(documentId: string, chunks: ChunkSplit[]): Promise<ChunkRow[]> {
  const rows: ChunkRow[] = []
  for (let i = 0; i < chunks.length; i++) {
    const row = await insertRow<Record<string, unknown>>(TABLE, {
      document_id: documentId,
      sequence_index: i,
      text_content: chunks[i].text,
      char_start: chunks[i].charStart,
      status: 'pending',
    })
    rows.push(mapRow(row))
  }
  return rows
}

export async function getChunksForDocument(documentId: string): Promise<ChunkRow[]> {
  const rows = await listRows<Record<string, unknown>>(TABLE, { filter: { document_id: documentId } })
  return rows.map(mapRow).sort((a, b) => a.sequenceIndex - b.sequenceIndex)
}

export async function markChunkReady(
  chunkId: string,
  data: { audioKey: string; timingData: TimingData; durationSeconds: number },
): Promise<void> {
  await updateRow(TABLE, chunkId, {
    status: 'ready',
    audio_key: data.audioKey,
    timing_data: data.timingData,
    duration_seconds: data.durationSeconds,
  })
}

export async function markChunkError(chunkId: string): Promise<void> {
  await updateRow(TABLE, chunkId, { status: 'error' })
}
