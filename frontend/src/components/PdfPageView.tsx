import { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
// Vite bundles the worker as its own asset via the `?url` suffix — keeps the
// PWA fully self-contained (no CDN), matching the rest of the app's model.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { originalFileUrl } from '../api/client'
import type { ChunkSummary, PdfLayout, PdfWordPosition } from '../api/types'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const RENDER_SCALE = 1.5

interface Props {
  documentId: string
  pageLayout: PdfLayout
  chunks: ChunkSummary[]
  activeChunkIndex: number
  activeWordIndex: number | null
  onWordTap: (chunkIndex: number, wordIndex: number) => void
}

/** Finds which chunk a global char offset falls in, using each ready chunk's known [charStart, charStart+textContent.length) span. */
function findChunkForOffset(chunks: ChunkSummary[], globalOffset: number): number | null {
  for (let i = 0; i < chunks.length; i++) {
    const start = chunks[i].charStart
    if (start === null) continue
    const end = start + chunks[i].textContent.length
    if (globalOffset >= start && globalOffset < end) return i
  }
  return null
}

function PdfPage({
  pdf,
  pageNumber,
  pageWidth,
  pageHeight,
  words,
  activeWordCharStart,
  onWordClick,
}: {
  pdf: pdfjsLib.PDFDocumentProxy
  pageNumber: number
  pageWidth: number
  pageHeight: number
  words: PdfWordPosition[]
  activeWordCharStart: number | null
  onWordClick: (word: PdfWordPosition) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const activeWordRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    let cancelled = false
    pdf.getPage(pageNumber).then((page) => {
      if (cancelled) return
      const viewport = page.getViewport({ scale: RENDER_SCALE })
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = viewport.width
      canvas.height = viewport.height
      page.render({ canvas, viewport }).promise.catch(() => {})
    })
    return () => {
      cancelled = true
    }
  }, [pdf, pageNumber])

  useEffect(() => {
    if (activeWordCharStart !== null) {
      activeWordRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [activeWordCharStart])

  return (
    <div className="pdf-page" style={{ aspectRatio: `${pageWidth} / ${pageHeight}` }}>
      <canvas ref={canvasRef} className="pdf-page-canvas" />
      {words.map((word, i) => {
        const isActive = word.charStart === activeWordCharStart
        return (
          <span
            key={i}
            ref={isActive ? activeWordRef : undefined}
            role="button"
            tabIndex={0}
            className={isActive ? 'pdf-word pdf-word-active' : 'pdf-word'}
            style={{
              left: `${word.x * 100}%`,
              top: `${word.y * 100}%`,
              width: `${word.width * 100}%`,
              height: `${word.height * 100}%`,
            }}
            onClick={() => onWordClick(word)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onWordClick(word)
            }}
          />
        )
      })}
    </div>
  )
}

/**
 * Renders the actual PDF pages client-side (pixel-accurate to the source
 * file) with word-tap/highlight overlays positioned from the backend's
 * per-word bounding boxes (pdfLayout.ts) — an alternative to ChunkText's
 * reflowed-text view for documents that have that layout data.
 */
export default function PdfPageView({ documentId, pageLayout, chunks, activeChunkIndex, activeWordIndex, onWordTap }: Props) {
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const task = pdfjsLib.getDocument(originalFileUrl(documentId))
    task.promise.then(
      (doc) => {
        if (!cancelled) setPdf(doc)
      },
      (err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load PDF')
      },
    )
    return () => {
      cancelled = true
      task.destroy()
    }
  }, [documentId])

  const wordsByPage = useMemo(() => {
    const map = new Map<number, PdfWordPosition[]>()
    for (const word of pageLayout.words) {
      const list = map.get(word.page) ?? []
      list.push(word)
      map.set(word.page, list)
    }
    return map
  }, [pageLayout])

  const activeWordCharStart = useMemo(() => {
    const chunk = chunks[activeChunkIndex]
    if (!chunk || chunk.charStart === null || activeWordIndex === null) return null
    const word = chunk.timingData?.words[activeWordIndex]
    if (!word) return null
    return chunk.charStart + word.charStart
  }, [chunks, activeChunkIndex, activeWordIndex])

  const handleWordClick = (word: PdfWordPosition) => {
    const chunkIndex = findChunkForOffset(chunks, word.charStart)
    if (chunkIndex === null) return
    const chunk = chunks[chunkIndex]
    if (!chunk.timingData || chunk.charStart === null) return
    const localOffset = word.charStart - chunk.charStart
    const wordIndex = chunk.timingData.words.findIndex((w) => w.charStart === localOffset)
    if (wordIndex === -1) return
    onWordTap(chunkIndex, wordIndex)
  }

  if (loadError) return <p role="alert">Couldn't load the PDF for Page view: {loadError}</p>
  if (!pdf) return <p>Loading page previews…</p>

  return (
    <div className="pdf-page-view">
      {pageLayout.pages.map((page) => (
        <PdfPage
          key={page.pageNumber}
          pdf={pdf}
          pageNumber={page.pageNumber}
          pageWidth={page.width}
          pageHeight={page.height}
          words={wordsByPage.get(page.pageNumber) ?? []}
          activeWordCharStart={activeWordCharStart}
          onWordClick={handleWordClick}
        />
      ))}
    </div>
  )
}
