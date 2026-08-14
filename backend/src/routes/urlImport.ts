import { Router } from 'express'
import { extractFromUrl } from '../services/urlImport.js'
import { ingestDocument, NoTextExtractedError } from '../services/documentPipeline.js'

export const urlImportRouter = Router()

// Web page import via URL (PRODUCT_PLAN.md §5, Phase 3 P1): paste a link,
// strip to readable text, feed into the same chunk/TTS pipeline as any
// other import.
urlImportRouter.post('/', async (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : ''
  if (!url) {
    res.status(400).json({ error: 'url is required' })
    return
  }

  try {
    const { title, text } = await extractFromUrl(url)

    const document = await ingestDocument({
      title,
      sourceType: 'url',
      fileBuffer: Buffer.from(text, 'utf-8'),
      fileContentType: 'text/plain',
      extractedText: text,
      voiceId: typeof req.body.voiceId === 'string' ? req.body.voiceId : undefined,
    })

    res.status(201).json({ document })
  } catch (err) {
    if (err instanceof NoTextExtractedError) {
      res.status(422).json({ error: err.message })
      return
    }
    const message = err instanceof Error ? err.message : 'Failed to import URL'
    console.error('URL ingest failed:', err)
    res.status(422).json({ error: message })
  }
})
