import { Router } from 'express'

export const documentsRouter = Router()

// TODO(Phase 1): accept multipart upload, run pdf.js/mammoth.js extraction,
// persist a `documents` row, kick off chunking + first-chunk TTS generation,
// return the new document id so the client can navigate to /reader/:id.
documentsRouter.post('/', (_req, res) => {
  res.status(501).json({ error: 'not implemented' })
})

// TODO(Phase 1): list documents for the library view.
documentsRouter.get('/', (_req, res) => {
  res.status(501).json({ error: 'not implemented' })
})

// TODO(Phase 1): return a document's chunks (text, audio_key, timing_data).
documentsRouter.get('/:id', (_req, res) => {
  res.status(501).json({ error: 'not implemented' })
})
