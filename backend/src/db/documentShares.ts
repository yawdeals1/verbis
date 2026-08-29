import { deleteRow, insertRow, listRows } from './studioClient.js'
import type { DocumentShareRow } from './types.js'

const TABLE = 'document_shares'

function mapRow(row: Record<string, unknown>): DocumentShareRow {
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    sharedByUserId: row.shared_by_user_id as string,
    sharedWithUserId: row.shared_with_user_id as string,
    createdAt: new Date(row.created_at as string).toISOString(),
  }
}

export async function shareDocument(input: {
  documentId: string
  sharedByUserId: string
  sharedWithUserId: string
}): Promise<DocumentShareRow> {
  const row = await insertRow<Record<string, unknown>>(TABLE, {
    document_id: input.documentId,
    shared_by_user_id: input.sharedByUserId,
    shared_with_user_id: input.sharedWithUserId,
  })
  return mapRow(row)
}

export async function listSharesForDocument(documentId: string): Promise<DocumentShareRow[]> {
  const rows = await listRows<Record<string, unknown>>(TABLE, { filter: { document_id: documentId } })
  return rows.map(mapRow)
}

export async function listSharesForUser(sharedWithUserId: string): Promise<DocumentShareRow[]> {
  const rows = await listRows<Record<string, unknown>>(TABLE, { filter: { shared_with_user_id: sharedWithUserId } })
  return rows.map(mapRow)
}

export async function findShare(documentId: string, sharedWithUserId: string): Promise<DocumentShareRow | null> {
  const rows = await listRows<Record<string, unknown>>(TABLE, {
    filter: { document_id: documentId, shared_with_user_id: sharedWithUserId },
    limit: 1,
  })
  return rows.length > 0 ? mapRow(rows[0]) : null
}

export async function removeShare(id: string): Promise<void> {
  await deleteRow(TABLE, id)
}
