import { getPool } from './pool.js'
import type { TimingData } from '../types/timing.js'
import type { ChunkRow, ChunkStatus } from './types.js'

function mapRow(row: Record<string, unknown>): ChunkRow {
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    sequenceIndex: row.sequence_index as number,
    textContent: row.text_content as string,
    status: row.status as ChunkStatus,
    audioKey: row.audio_key as string | null,
    timingData: row.timing_data as TimingData | null,
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
  }
}

export async function createChunks(documentId: string, texts: string[]): Promise<ChunkRow[]> {
  const pool = getPool()
  const rows: ChunkRow[] = []
  for (let i = 0; i < texts.length; i++) {
    const { rows: inserted } = await pool.query(
      `INSERT INTO chunks (document_id, sequence_index, text_content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [documentId, i, texts[i]],
    )
    rows.push(mapRow(inserted[0]))
  }
  return rows
}

export async function getChunksForDocument(documentId: string): Promise<ChunkRow[]> {
  const { rows } = await getPool().query(
    'SELECT * FROM chunks WHERE document_id = $1 ORDER BY sequence_index ASC',
    [documentId],
  )
  return rows.map(mapRow)
}

export async function getChunkBySequence(
  documentId: string,
  sequenceIndex: number,
): Promise<ChunkRow | null> {
  const { rows } = await getPool().query(
    'SELECT * FROM chunks WHERE document_id = $1 AND sequence_index = $2',
    [documentId, sequenceIndex],
  )
  return rows[0] ? mapRow(rows[0]) : null
}

export async function markChunkReady(
  chunkId: string,
  data: { audioKey: string; timingData: TimingData; durationSeconds: number },
): Promise<void> {
  await getPool().query(
    `UPDATE chunks SET status = 'ready', audio_key = $2, timing_data = $3, duration_seconds = $4
     WHERE id = $1`,
    [chunkId, data.audioKey, JSON.stringify(data.timingData), data.durationSeconds],
  )
}

export async function markChunkError(chunkId: string): Promise<void> {
  await getPool().query("UPDATE chunks SET status = 'error' WHERE id = $1", [chunkId])
}
