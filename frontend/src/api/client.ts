import type { AdminUser, CurrentUser, Document, DocumentDetail, Folder, Voice } from './types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json()
    return typeof body?.error === 'string' ? body.error : response.statusText
  } catch {
    return response.statusText
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

async function upload<T>(path: string, formData: FormData): Promise<T> {
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
  return request<{ documents: Document[] }>('/documents')
}

export function getDocument(id: string) {
  return request<DocumentDetail>(`/documents/${id}`)
}

export function uploadDocument(file: File, voiceId?: string) {
  const formData = new FormData()
  formData.append('file', file)
  if (voiceId) formData.append('voiceId', voiceId)
  return upload<{ document: Document }>('/documents', formData)
}

export function uploadScan(file: File, opts: { voiceId?: string; title?: string }) {
  const formData = new FormData()
  formData.append('file', file)
  if (opts.voiceId) formData.append('voiceId', opts.voiceId)
  if (opts.title) formData.append('title', opts.title)
  return upload<{ document: Document }>('/documents/scan', formData)
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
  return request<{ user: AdminUser }>('/admin/invite', {
    method: 'POST',
    body: JSON.stringify({ email, username, role }),
  })
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
