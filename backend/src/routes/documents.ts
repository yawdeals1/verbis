import { Router } from 'express'
import multer from 'multer'
import path from 'node:path'
import { getDocument, listDocuments, updateLastPosition } from '../db/documents.js'
import { getChunksForDocument } from '../db/chunks.js'
import { getVoice } from '../db/voices.js'
import { getObjectBuffer } from '../storage/index.js'
import { extractDocxText, extractEpubText, extractPdfText, extractTxtText } from '../services/textExtraction.js'
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

const EXTRACTORS: Partial<Record<SourceType, (buffer: Buffer) => Promise<string> | string>> = {
  pdf: extractPdfText,
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

  const extractor = EXTRACTORS[sourceType]
  if (!extractor) {
    res.status(400).json({ error: `No extractor registered for ${sourceType}` })
    return
  }

  try {
    const extractedText = await extractor(req.file.buffer)
    const title = path.basename(req.file.originalname, path.extname(req.file.originalname))

    const document = await ingestDocument({
      title,
      sourceType,
      fileBuffer: req.file.buffer,
      fileContentType: req.file.mimetype || 'application/octet-stream',
      extractedText,
      voiceId: typeof req.body.voiceId === 'string' ? req.body.voiceId : undefined,
    })

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
      status: chunk.status,
      durationSeconds: chunk.durationSeconds,
      timingData: chunk.timingData,
      audioUrl: chunk.status === 'ready' ? `/documents/${document.id}/chunks/${chunk.sequenceIndex}/audio` : null,
    })),
  })
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
    res.send(buffer)
  } catch (err) {
    console.error('Failed to load chunk audio:', err)
    res.status(500).json({ error: 'Failed to load audio' })
  }
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
