import { Router } from 'express'
import multer from 'multer'
import path from 'node:path'
import { deleteDocument, getDocument, listDocuments, updateLastPosition } from '../db/documents.js'
import { getChunksForDocument } from '../db/chunks.js'
import { getVoice } from '../db/voices.js'
import { deleteObject, getObjectBuffer } from '../storage/index.js'
import { extractDocxText, extractEpubText, extractTxtText } from '../services/textExtraction.js'
import { extractPdfLayout } from '../services/pdfLayout.js'
import { ingestDocument, NoTextExtractedError } from '../services/documentPipeline.js'
import { scanRouter } from './scan.js'
import { insightsRouter } from './insights.js'
import { urlImportRouter } from './urlImport.js'
import type { SourceType } from '../db/types.js'

export const documentsRouter = Router()

documentsRouter.use('/scan', scanRouter)
documentsRouter.use('/url', urlImportRouter)
documentsRouter.use(insightsRouter)

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

// PDF is handled separately below (extractPdfLayout returns bounding-box
// data alongside text, which these plain extractors don't).
const EXTRACTORS: Partial<Record<SourceType, (buffer: Buffer) => Promise<string> | string>> = {
  docx: extractDocxText,
  txt: extractTxtText,
  epub: extractEpubText,
}

function sourceTypeFromFilename(filename: string): SourceType | null {
  const ext = path.extname(filename).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (ext === '.docx') return 'docx'
  if (ext === '.txt') return 'txt'
  if (ext === '.epub') return 'epub'
  return null
}

documentsRouter.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Missing file' })
    return
  }

  const sourceType = sourceTypeFromFilename(req.file.originalname)
  if (!sourceType) {
    res.status(400).json({ error: 'Unsupported file type. Use PDF, DOCX, TXT, or EPUB.' })
    return
  }

  if (sourceType !== 'pdf' && !EXTRACTORS[sourceType]) {
    res.status(400).json({ error: `No extractor registered for ${sourceType}` })
    return
  }

  try {
    const title = path.basename(req.file.originalname, path.extname(req.file.originalname))

    const document = await (async () => {
      if (sourceType === 'pdf') {
        const { text, pages, words } = await extractPdfLayout(req.file!.buffer)
        return ingestDocument({
          title,
          sourceType,
          fileBuffer: req.file!.buffer,
          fileContentType: req.file!.mimetype || 'application/octet-stream',
          extractedText: text,
          pageLayout: { pages, words },
          voiceId: typeof req.body.voiceId === 'string' ? req.body.voiceId : undefined,
        })
      }
      const extractedText = await EXTRACTORS[sourceType]!(req.file!.buffer)
      return ingestDocument({
        title,
        sourceType,
        fileBuffer: req.file!.buffer,
        fileContentType: req.file!.mimetype || 'application/octet-stream',
        extractedText,
        voiceId: typeof req.body.voiceId === 'string' ? req.body.voiceId : undefined,
      })
    })()

    res.status(201).json({ document })
  } catch (err) {
    if (err instanceof NoTextExtractedError) {
      res.status(422).json({ error: err.message })
      return
    }
    console.error('Document ingest failed:', err)
    res.status(500).json({ error: 'Failed to process document.' })
  }
})

documentsRouter.get('/', async (_req, res) => {
  const documents = await listDocuments()
  res.json({ documents })
})

documentsRouter.get('/:id', async (req, res) => {
  const document = await getDocument(req.params.id)
  if (!document) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  const [chunks, voice] = await Promise.all([
    getChunksForDocument(document.id),
    document.voiceId ? getVoice(document.voiceId) : Promise.resolve(null),
  ])

  res.json({
    document,
    voice,
    chunks: chunks.map((chunk) => ({
      id: chunk.id,
      sequenceIndex: chunk.sequenceIndex,
      textContent: chunk.textContent,
      charStart: chunk.charStart,
      status: chunk.status,
      durationSeconds: chunk.durationSeconds,
      timingData: chunk.timingData,
      audioUrl: chunk.status === 'ready' ? `/documents/${document.id}/chunks/${chunk.sequenceIndex}/audio` : null,
    })),
  })
})

documentsRouter.get('/:id/original', async (req, res) => {
  const document = await getDocument(req.params.id)
  if (!document) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  try {
    const buffer = await getObjectBuffer(document.originalFileKey)
    res.setHeader('Content-Type', document.sourceType === 'pdf' ? 'application/pdf' : 'application/octet-stream')
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.send(buffer)
  } catch (err) {
    console.error('Failed to load original file:', err)
    res.status(500).json({ error: 'Failed to load original file' })
  }
})

documentsRouter.get('/:id/chunks/:sequenceIndex/audio', async (req, res) => {
  const document = await getDocument(req.params.id)
  if (!document) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  const chunks = await getChunksForDocument(document.id)
  const chunk = chunks.find((c) => c.sequenceIndex === Number(req.params.sequenceIndex))
  if (!chunk || chunk.status !== 'ready' || !chunk.audioKey) {
    res.status(404).json({ error: 'Chunk audio not ready' })
    return
  }

  try {
    const buffer = await getObjectBuffer(chunk.audioKey)
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    // <audio> elements need Range support to seek — without it, the browser
    // marks the resource as unseekable after its initial probe request and
    // silently drops any later `currentTime` assignment (tap-to-jump lands
    // back at 0 instead of the tapped word).
    res.setHeader('Accept-Ranges', 'bytes')

    const range = req.headers.range
    if (!range) {
      res.setHeader('Content-Length', buffer.length)
      res.send(buffer)
      return
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    const start = match?.[1] ? Number(match[1]) : 0
    const end = match?.[2] ? Number(match[2]) : buffer.length - 1
    if (!match || start > end || end >= buffer.length) {
      res.status(416).setHeader('Content-Range', `bytes */${buffer.length}`).end()
      return
    }

    res.status(206)
    res.setHeader('Content-Range', `bytes ${start}-${end}/${buffer.length}`)
    res.setHeader('Content-Length', end - start + 1)
    res.send(buffer.subarray(start, end + 1))
  } catch (err) {
    console.error('Failed to load chunk audio:', err)
    res.status(500).json({ error: 'Failed to load audio' })
  }
})

documentsRouter.delete('/:id', async (req, res) => {
  const document = await getDocument(req.params.id)
  if (!document) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  const chunks = await getChunksForDocument(document.id)
  const audioKeys = chunks.map((c) => c.audioKey).filter((key): key is string => key !== null)

  // Best-effort: a storage object already missing (or a transient bucket
  // error) shouldn't block removing the document itself.
  await Promise.all(
    [document.originalFileKey, ...audioKeys].map((key) =>
      deleteObject(key).catch((err) => console.error(`Failed to delete storage object ${key}:`, err)),
    ),
  )

  await deleteDocument(document.id)
  res.status(204).send()
})

documentsRouter.patch('/:id/position', async (req, res) => {
  const { chunkSequenceIndex, timeSeconds } = req.body ?? {}
  if (typeof chunkSequenceIndex !== 'number' || typeof timeSeconds !== 'number') {
    res.status(400).json({ error: 'chunkSequenceIndex and timeSeconds are required numbers' })
    return
  }

  const document = await getDocument(req.params.id)
  if (!document) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  await updateLastPosition(document.id, { chunkSequenceIndex, timeSeconds })
  res.status(204).send()
})
