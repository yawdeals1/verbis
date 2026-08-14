import type { TimingData } from '../types/timing.js'

export type SourceType = 'pdf' | 'docx' | 'txt' | 'epub' | 'scan' | 'url'
export type DocumentStatus = 'processing' | 'ready' | 'error'
export type ChunkStatus = 'pending' | 'ready' | 'error'

export interface LastPosition {
  chunkSequenceIndex: number
  timeSeconds: number
}

export interface DocumentRow {
  id: string
  title: string
  sourceType: SourceType
  originalFileKey: string
  voiceId: string | null
  status: DocumentStatus
  errorMessage: string | null
  lastPosition: LastPosition | null
  summary: string | null
  createdAt: string
}

export interface ChunkRow {
  id: string
  documentId: string
  sequenceIndex: number
  textContent: string
  status: ChunkStatus
  audioKey: string | null
  timingData: TimingData | null
  durationSeconds: number | null
}

export interface VoiceRow {
  id: string
  provider: string
  providerVoiceId: string
  displayName: string
}
