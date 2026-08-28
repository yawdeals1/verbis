import { deleteRow, getRow, insertRow, listRows, updateRow } from './studioClient.js'
import type { FolderRow } from './types.js'

const TABLE = 'folders'

function mapRow(row: Record<string, unknown>): FolderRow {
  return {
    id: row.id as string,
    name: row.name as string,
    createdAt: new Date(row.created_at as string).toISOString(),
  }
}

export async function createFolder(name: string): Promise<FolderRow> {
  const row = await insertRow<Record<string, unknown>>(TABLE, { name })
  return mapRow(row)
}

export async function listFolders(): Promise<FolderRow[]> {
  const rows = await listRows<Record<string, unknown>>(TABLE)
  return rows.map(mapRow).sort((a, b) => a.name.localeCompare(b.name))
}

export async function getFolder(id: string): Promise<FolderRow | null> {
  const row = await getRow<Record<string, unknown>>(TABLE, id)
  return row ? mapRow(row) : null
}

export async function renameFolder(id: string, name: string): Promise<FolderRow> {
  const row = await updateRow<Record<string, unknown>>(TABLE, id, { name })
  return mapRow(row)
}

/** Deletes the folder row — documents.folder_id is set NULL via the DB's ON DELETE SET NULL FK, so filed documents are un-filed rather than removed. */
export async function deleteFolder(id: string): Promise<void> {
  await deleteRow(TABLE, id)
}
