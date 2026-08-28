import { deleteRow, getRow, insertRow, listRows, updateRow } from './studioClient.js'
import type { DocumentRow, DocumentStatus, LastPosition, SourceType } from './types.js'

const TABLE = 'documents'

function mapRow(row: Record<string, unknown>): DocumentRow {
  return {
    id: row.id as string,
    title: row.title as string,
    sourceType: row.source_type as SourceType,
    originalFileKey: row.original_file_key as string,
    voiceId: (row.voice_id as string | null) ?? null,
    folderId: (row.folder_id as string | null) ?? null,
    status: row.status as DocumentStatus,
    errorMessage: (row.error_message as string | null) ?? null,
    lastPosition: (row.last_position as LastPosition | null) ?? null,
    summary: (row.summary as string | null) ?? null,
    pageLayout: (row.page_layout as DocumentRow['pageLayout']) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
  }
}

export async function createDocument(input: {
  title: string
  sourceType: SourceType
  originalFileKey: string
  voiceId: string
  pageLayout?: DocumentRow['pageLayout']
}): Promise<DocumentRow> {
  const row = await insertRow<Record<string, unknown>>(TABLE, {
    title: input.title,
    source_type: input.sourceType,
    original_file_key: input.originalFileKey,
    voice_id: input.voiceId,
    status: 'processing',
    page_layout: input.pageLayout ?? null,
  })
  return mapRow(row)
}

export async function getDocument(id: string): Promise<DocumentRow | null> {
  const row = await getRow<Record<string, unknown>>(TABLE, id)
  return row ? mapRow(row) : null
}

export async function listDocuments(): Promise<DocumentRow[]> {
  const rows = await listRows<Record<string, unknown>>(TABLE)
  return rows.map(mapRow).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function updateDocumentStatus(
  id: string,
  status: DocumentStatus,
  errorMessage?: string,
): Promise<void> {
  await updateRow(TABLE, id, { status, error_message: errorMessage ?? null })
}

export async function updateLastPosition(id: string, position: LastPosition): Promise<void> {
  await updateRow(TABLE, id, { last_position: position })
}

export async function updateSummary(id: string, summary: string): Promise<void> {
  await updateRow(TABLE, id, { summary })
}

export async function updateDocumentFolder(id: string, folderId: string | null): Promise<void> {
  await updateRow(TABLE, id, { folder_id: folderId })
}

export async function updatePageLayout(id: string, pageLayout: DocumentRow['pageLayout']): Promise<void> {
  await updateRow(TABLE, id, { page_layout: pageLayout })
}

/** Deletes the document row — chunks cascade via the DB's ON DELETE CASCADE FK. Storage cleanup (original file, chunk audio) is the caller's responsibility, since that lives outside the DB. */
export async function deleteDocument(id: string): Promise<void> {
  await deleteRow(TABLE, id)
}
