export type SourceType = 'pdf' | 'docx' | 'txt' | 'epub' | 'scan' | 'url'
export type DocumentStatus = 'processing' | 'ready' | 'error'
export type ChunkStatus = 'pending' | 'ready' | 'error'

export interface LastPosition {
  chunkSequenceIndex: number
  timeSeconds: number
}

export interface PdfPage {
  pageNumber: number
  width: number
  height: number
}

export interface PdfWordPosition {
  charStart: number
  charEnd: number
  page: number
  /** Fractions (0..1) of the page's width/height, top-left origin. */
  x: number
  y: number
  width: number
  height: number
}

export interface PdfLayout {
  pages: PdfPage[]
  words: PdfWordPosition[]
}

export interface Folder {
  id: string
  name: string
  createdAt: string
}

export interface Document {
  id: string
  title: string
  sourceType: SourceType
  originalFileKey: string
  voiceId: string | null
  folderIds: string[]
  status: DocumentStatus
  errorMessage: string | null
  lastPosition: LastPosition | null
  summary: string | null
  /** PDF-only — null for other source types and for PDFs imported before this existed. */
  pageLayout: PdfLayout | null
  createdAt: string
  chunksTotal: number
  chunksReady: number
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
  /** This chunk's starting offset within the document's full extracted text — pairs with Document.pageLayout.words to position highlights on the rendered PDF page. Null when the source has no page layout. */
  charStart: number | null
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
  locale: string | null
  previewAudioUrl: string | null
}

export interface DocumentDetail {
  document: Document
  voice: Voice | null
  chunks: ChunkSummary[]
}
