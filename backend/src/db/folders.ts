import { deleteRow, getRow, insertRow, listRows, updateRow } from './studioClient.js'
import type { FolderRow } from './types.js'

const TABLE = 'folders'

function mapRow(row: Record<string, unknown>): FolderRow {
  return {
    id: row.id as string,
    name: row.name as string,
    ownerId: row.owner_id as string,
    createdAt: new Date(row.created_at as string).toISOString(),
  }
}

export async function createFolder(name: string, ownerId: string): Promise<FolderRow> {
  const row = await insertRow<Record<string, unknown>>(TABLE, { name, owner_id: ownerId })
  return mapRow(row)
}

export async function listFoldersByOwner(ownerId: string): Promise<FolderRow[]> {
  const rows = await listRows<Record<string, unknown>>(TABLE, { filter: { owner_id: ownerId } })
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

/** Deletes the folder row — document_folders.folder_id cascades via the DB's ON DELETE CASCADE FK, so documents just lose this one association (they may still belong to other folders) rather than being removed. */
export async function deleteFolder(id: string): Promise<void> {
  await deleteRow(TABLE, id)
}
