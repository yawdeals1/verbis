import { getPool } from './pool.js'
import type { DocumentRow, DocumentStatus, LastPosition, SourceType } from './types.js'

function mapRow(row: Record<string, unknown>): DocumentRow {
  return {
    id: row.id as string,
    title: row.title as string,
    sourceType: row.source_type as SourceType,
    originalFileKey: row.original_file_key as string,
    voiceId: row.voice_id as string | null,
    status: row.status as DocumentStatus,
    errorMessage: row.error_message as string | null,
    lastPosition: row.last_position as LastPosition | null,
    summary: row.summary as string | null,
    createdAt: (row.created_at as Date).toISOString(),
  }
}

export async function createDocument(input: {
  title: string
  sourceType: SourceType
  originalFileKey: string
  voiceId: string
}): Promise<DocumentRow> {
  const { rows } = await getPool().query(
    `INSERT INTO documents (title, source_type, original_file_key, voice_id, status)
     VALUES ($1, $2, $3, $4, 'processing')
     RETURNING *`,
    [input.title, input.sourceType, input.originalFileKey, input.voiceId],
  )
  return mapRow(rows[0])
}

export async function getDocument(id: string): Promise<DocumentRow | null> {
  const { rows } = await getPool().query('SELECT * FROM documents WHERE id = $1', [id])
  return rows[0] ? mapRow(rows[0]) : null
}

export async function listDocuments(): Promise<DocumentRow[]> {
  const { rows } = await getPool().query('SELECT * FROM documents ORDER BY created_at DESC')
  return rows.map(mapRow)
}

export async function updateDocumentStatus(
  id: string,
  status: DocumentStatus,
  errorMessage?: string,
): Promise<void> {
  await getPool().query('UPDATE documents SET status = $2, error_message = $3 WHERE id = $1', [
    id,
    status,
    errorMessage ?? null,
  ])
}

export async function updateLastPosition(id: string, position: LastPosition): Promise<void> {
  await getPool().query('UPDATE documents SET last_position = $2 WHERE id = $1', [
    id,
    JSON.stringify(position),
  ])
}

export async function updateSummary(id: string, summary: string): Promise<void> {
  await getPool().query('UPDATE documents SET summary = $2 WHERE id = $1', [id, summary])
}
