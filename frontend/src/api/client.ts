import type { Document, DocumentDetail, Folder, Voice } from './types'

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
    ...init,
  })

  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response))
  }

  if (response.status === 204) return undefined as T

  return response.json() as Promise<T>
}

async function upload<T>(path: string, formData: FormData): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { method: 'POST', body: formData })

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

export function moveDocumentToFolder(documentId: string, folderId: string | null) {
  return request<void>(`/documents/${documentId}/folder`, {
    method: 'PATCH',
    body: JSON.stringify({ folderId }),
  })
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
