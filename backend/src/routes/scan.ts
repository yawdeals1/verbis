import { Router } from 'express'
import multer from 'multer'
import { extractTextFromImage } from '../services/ocr.js'
import { ingestDocument, NoTextExtractedError } from '../services/documentPipeline.js'
import { requireRole } from '../middleware/auth.js'

export const scanRouter = Router()

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

// Camera capture or photo upload of a physical book page (PRODUCT_PLAN.md
// Phase 2). Reuses the same chunk/TTS pipeline as file imports — OCR is
// just another text-extraction path feeding the same downstream flow.
scanRouter.post('/', requireRole('admin', 'contributor'), upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Missing file' })
    return
  }

  try {
    const extractedText = await extractTextFromImage(req.file.buffer)
    const title = typeof req.body.title === 'string' && req.body.title.trim() ? req.body.title.trim() : 'Scanned page'

    const document = await ingestDocument({
      title,
      sourceType: 'scan',
      fileBuffer: req.file.buffer,
      fileContentType: req.file.mimetype || 'image/jpeg',
      extractedText,
      ownerId: req.user!.id,
      voiceId: typeof req.body.voiceId === 'string' ? req.body.voiceId : undefined,
    })

    res.status(201).json({ document })
  } catch (err) {
    if (err instanceof NoTextExtractedError) {
      res.status(422).json({ error: 'No readable text was found in the photo. Try better lighting or a straighter angle.' })
      return
    }
    console.error('Scan ingest failed:', err)
    res.status(500).json({ error: 'Failed to process scanned page.' })
  }
})
