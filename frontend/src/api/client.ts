import type { AdminUser, CurrentUser, Document, DocumentDetail, Folder, LibraryDocument, Voice } from './types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// Over HTTP/2 statusText is always empty, so a non-JSON error page (e.g. a
// proxy's 413) would otherwise surface as a blank message and the import
// form would just silently reset.
function fallbackMessage(response: Response): string {
  if (response.status === 413) return 'This file is too large to upload.'
  return response.statusText || `Request failed (${response.status})`
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json()
    return typeof body?.error === 'string' ? body.error : fallbackMessage(response)
  } catch {
    return fallbackMessage(response)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    credentials: 'include',
    ...init,
  })

  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response))
  }

  if (response.status === 204) return undefined as T

  return response.json() as Promise<T>
}

// Deploro's shared VPS proxy rejects request bodies over 1MB before they
// reach the backend, so anything bigger is staged in parts via /uploads and
// the import route is then called with its uploadId (backend routes/uploads.ts).
const DIRECT_UPLOAD_MAX_BYTES = 512 * 1024
const PARALLEL_PART_UPLOADS = 4

async function stageFile(file: File): Promise<string> {
  const { uploadId, partSize } = await request<{ uploadId: string; partSize: number }>('/uploads', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
  })

  const partCount = Math.ceil(file.size / partSize)
  let nextPart = 0
  const sendParts = async () => {
    while (nextPart < partCount) {
      const index = nextPart++
      await request<void>(`/uploads/${uploadId}/parts/${index}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file.slice(index * partSize, (index + 1) * partSize),
      })
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL_PART_UPLOADS, partCount) }, sendParts))

  return uploadId
}

async function upload<T>(path: string, file: File, fields: Record<string, string | undefined>): Promise<T> {
  const formData = new FormData()
  if (file.size <= DIRECT_UPLOAD_MAX_BYTES) formData.append('file', file)
  else formData.append('uploadId', await stageFile(file))
  for (const [key, value] of Object.entries(fields)) {
    if (value) formData.append(key, value)
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { method: 'POST', body: formData, credentials: 'include' })

  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response))
  }

  return response.json() as Promise<T>
}

export interface HealthStatus {
  status: 'ok'
  timestamp: string
}

export function getHealth() {
  return request<HealthStatus>('/health')
}

export function listDocuments() {
  return request<{ documents: LibraryDocument[] }>('/documents')
}

export function getDocument(id: string) {
  return request<DocumentDetail>(`/documents/${id}`)
}

export function uploadDocument(file: File, voiceId?: string) {
  return upload<{ document: Document }>('/documents', file, { voiceId })
}

export function uploadScan(file: File, opts: { voiceId?: string; title?: string }) {
  return upload<{ document: Document }>('/documents/scan', file, { voiceId: opts.voiceId, title: opts.title })
}

export function importUrl(url: string, voiceId?: string) {
  return request<{ document: Document }>('/documents/url', {
    method: 'POST',
    body: JSON.stringify({ url, voiceId }),
  })
}

export function listVoices() {
  return request<{ voices: Voice[] }>('/voices')
}

export function updatePosition(documentId: string, chunkSequenceIndex: number, timeSeconds: number) {
  return request<void>(`/documents/${documentId}/position`, {
    method: 'PATCH',
    body: JSON.stringify({ chunkSequenceIndex, timeSeconds }),
  })
}

export function deleteDocument(documentId: string) {
  return request<void>(`/documents/${documentId}`, { method: 'DELETE' })
}

export function addDocumentToFolder(documentId: string, folderId: string) {
  return request<void>(`/documents/${documentId}/folders/${folderId}`, { method: 'POST' })
}

export function removeDocumentFromFolder(documentId: string, folderId: string) {
  return request<void>(`/documents/${documentId}/folders/${folderId}`, { method: 'DELETE' })
}

export function listFolders() {
  return request<{ folders: Folder[] }>('/folders')
}

export function createFolder(name: string) {
  return request<{ folder: Folder }>('/folders', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function renameFolder(folderId: string, name: string) {
  return request<{ folder: Folder }>(`/folders/${folderId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export function deleteFolder(folderId: string) {
  return request<void>(`/folders/${folderId}`, { method: 'DELETE' })
}

export function getSummary(documentId: string) {
  return request<{ summary: string }>(`/documents/${documentId}/summary`, { method: 'POST' })
}

export function askQuestion(documentId: string, question: string) {
  return request<{ answer: string }>(`/documents/${documentId}/qa`, {
    method: 'POST',
    body: JSON.stringify({ question }),
  })
}

export function chunkAudioUrl(documentId: string, sequenceIndex: number): string {
  return `${API_BASE_URL}/documents/${documentId}/chunks/${sequenceIndex}/audio`
}

export function originalFileUrl(documentId: string): string {
  return `${API_BASE_URL}/documents/${documentId}/original`
}

export function mergedAudioUrl(documentId: string): string {
  return `${API_BASE_URL}/documents/${documentId}/merged-audio`
}

export function mergeDocumentAudio(documentId: string) {
  return request<{ merged: true; chunkCount: number; complete: boolean }>(`/documents/${documentId}/merge`, {
    method: 'POST',
  })
}

export function login(email: string, password: string) {
  return request<{ user: CurrentUser }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}

export function logout() {
  return request<void>('/auth/logout', { method: 'POST' })
}

export function getMe() {
  return request<{ user: CurrentUser }>('/auth/me')
}

export function acceptInvite(email: string, password: string) {
  return request<{ ok: true }>('/auth/accept-invite', { method: 'POST', body: JSON.stringify({ email, password }) })
}

export function forgotPassword(email: string) {
  return request<{ ok: true }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) })
}

export function resetPassword(token: string, password: string) {
  return request<{ ok: true }>('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) })
}

export function adminListUsers() {
  return request<{ users: AdminUser[] }>('/admin/users')
}

export function adminInvite(email: string, username: string, role: 'member' | 'contributor') {
  return request<{ user: AdminUser; emailSent: boolean }>('/admin/invite', {
    method: 'POST',
    body: JSON.stringify({ email, username, role }),
  })
}

export function adminResendInvite(userId: string) {
  return request<{ ok: true }>(`/admin/users/${userId}/resend-invite`, { method: 'POST' })
}

export function listDocumentShares(documentId: string) {
  return request<{ shares: { id: string; userId: string; username?: string }[] }>(`/documents/${documentId}/shares`)
}

export function shareDocument(documentId: string, username: string) {
  return request<{ userId: string; username: string }>(`/documents/${documentId}/shares`, {
    method: 'POST',
    body: JSON.stringify({ username }),
  })
}

export function unshareDocument(documentId: string, userId: string) {
  return request<void>(`/documents/${documentId}/shares/${userId}`, { method: 'DELETE' })
}
