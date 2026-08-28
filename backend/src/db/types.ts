import type { TimingData } from '../types/timing.js'
import type { PdfLayout } from '../services/pdfLayout.js'

export type SourceType = 'pdf' | 'docx' | 'txt' | 'epub' | 'scan' | 'url'
export type DocumentStatus = 'processing' | 'ready' | 'error'
export type ChunkStatus = 'pending' | 'ready' | 'error'

export interface LastPosition {
  chunkSequenceIndex: number
  timeSeconds: number
}

export interface FolderRow {
  id: string
  name: string
  createdAt: string
}

export interface DocumentRow {
  id: string
  title: string
  sourceType: SourceType
  originalFileKey: string
  voiceId: string | null
  folderId: string | null
  status: DocumentStatus
  errorMessage: string | null
  lastPosition: LastPosition | null
  summary: string | null
  /** PDF-only: per-word bounding boxes for the real-PDF-rendering reader view. Null for non-PDF sources and for PDFs imported before this existed. */
  pageLayout: Pick<PdfLayout, 'pages' | 'words'> | null
  createdAt: string
}

export interface ChunkRow {
  id: string
  documentId: string
  sequenceIndex: number
  textContent: string
  /** This chunk's starting offset within the document's full extracted text — see chunking.ts's ChunkSplit. Only meaningful for PDFs (used to map TTS word timing onto documents.pageLayout); harmless/unused otherwise. */
  charStart: number | null
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
  locale: string | null
  previewAudioUrl: string | null
}
