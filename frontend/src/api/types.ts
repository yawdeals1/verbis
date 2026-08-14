export type SourceType = 'pdf' | 'docx' | 'txt' | 'epub' | 'scan' | 'url'
export type DocumentStatus = 'processing' | 'ready' | 'error'
export type ChunkStatus = 'pending' | 'ready' | 'error'

export interface LastPosition {
  chunkSequenceIndex: number
  timeSeconds: number
}

export interface Document {
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

export interface WordTiming {
  word: string
  charStart: number
  charEnd: number
  startMs: number
  endMs: number
}

export interface TimingData {
  words: WordTiming[]
}

export interface ChunkSummary {
  id: string
  sequenceIndex: number
  textContent: string
  status: ChunkStatus
  durationSeconds: number | null
  timingData: TimingData | null
  audioUrl: string | null
}

export interface Voice {
  id: string
  provider: string
  providerVoiceId: string
  displayName: string
}

export interface DocumentDetail {
  document: Document
  voice: Voice | null
  chunks: ChunkSummary[]
}
