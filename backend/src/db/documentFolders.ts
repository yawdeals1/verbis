import { deleteRow, insertRow, listRows } from './studioClient.js'

const TABLE = 'document_folders'

interface DocumentFolderRow {
  id: string
  documentId: string
  folderId: string
}

function mapRow(row: Record<string, unknown>): DocumentFolderRow {
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    folderId: row.folder_id as string,
  }
}

export async function listFolderIdsForDocument(documentId: string): Promise<string[]> {
  const rows = await listRows<Record<string, unknown>>(TABLE, { filter: { document_id: documentId } })
  return rows.map(mapRow).map((r) => r.folderId)
}

/** All document-to-folder associations, grouped by document id — one round trip instead of one per document when annotating the library list. */
export async function listAllDocumentFolders(): Promise<Map<string, string[]>> {
  const rows = await listRows<Record<string, unknown>>(TABLE, { limit: 5000 })
  const byDocument = new Map<string, string[]>()
  for (const row of rows.map(mapRow)) {
    const existing = byDocument.get(row.documentId)
    if (existing) existing.push(row.folderId)
    else byDocument.set(row.documentId, [row.folderId])
  }
  return byDocument
}

export async function addDocumentToFolder(documentId: string, folderId: string): Promise<void> {
  const existing = await listRows<Record<string, unknown>>(TABLE, {
    filter: { document_id: documentId, folder_id: folderId },
  })
  if (existing.length > 0) return
  await insertRow(TABLE, { document_id: documentId, folder_id: folderId })
}

export async function removeDocumentFromFolder(documentId: string, folderId: string): Promise<void> {
  const existing = await listRows<Record<string, unknown>>(TABLE, {
    filter: { document_id: documentId, folder_id: folderId },
  })
  await Promise.all(existing.map((row) => deleteRow(TABLE, (row as Record<string, unknown>).id as string)))
}
