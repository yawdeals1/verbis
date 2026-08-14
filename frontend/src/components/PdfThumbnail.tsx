import { useEffect, useRef, useState } from 'react'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { originalFileUrl } from '../api/client'

const THUMBNAIL_WIDTH = 320

/** Renders the PDF's first page into a small canvas for the Library tile — a real preview instead of a static "PDF" label. Falls back to the label on any load/render failure. */
export default function PdfThumbnail({ documentId }: { documentId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false

    import('pdfjs-dist').then(async (pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
      try {
        const pdf = await pdfjsLib.getDocument(originalFileUrl(documentId)).promise
        if (cancelled) return
        const page = await pdf.getPage(1)
        if (cancelled) return
        const baseViewport = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: THUMBNAIL_WIDTH / baseViewport.width })
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = viewport.width
        canvas.height = viewport.height
        await page.render({ canvas, viewport }).promise
      } catch {
        if (!cancelled) setFailed(true)
      }
    })

    return () => {
      cancelled = true
    }
  }, [documentId])

  if (failed) return <span className="library-card-tile-type">PDF</span>
  return <canvas ref={canvasRef} className="library-card-thumbnail" />
}
