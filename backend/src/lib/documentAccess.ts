import { getDocument } from '../db/documents.js'
import { findShare } from '../db/documentShares.js'
import type { DocumentRow, UserRow } from '../db/types.js'

/**
 * A document is accessible to a user if they own it or it's been shared
 * with them — this is the read-access check used across every
 * document-scoped route (documents.ts, insights.ts). Returns null (→ 404)
 * rather than distinguishing "doesn't exist" from "exists but not
 * accessible", same as before per-user auth existed.
 */
export async function getAccessibleDocument(id: string, user: UserRow): Promise<DocumentRow | null> {
  const document = await getDocument(id)
  if (!document) return null
  if (document.ownerId === user.id) return document
  const share = await findShare(id, user.id)
  return share ? document : null
}

/** Owner-only documents (delete, folder assignment, sharing, position) use this instead — a shared recipient never gets write access. */
export async function getOwnedDocument(id: string, user: UserRow): Promise<DocumentRow | null> {
  const document = await getDocument(id)
  return document && document.ownerId === user.id ? document : null
}
