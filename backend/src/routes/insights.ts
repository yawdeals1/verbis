import { Router } from 'express'
import { updateSummary } from '../db/documents.js'
import { getChunksForDocument } from '../db/chunks.js'
import { answerQuestion, summarizeDocument } from '../services/ollama.js'
import { getAccessibleDocument } from '../lib/documentAccess.js'

export const insightsRouter = Router()

async function fullTextFor(documentId: string): Promise<string> {
  const chunks = await getChunksForDocument(documentId)
  return chunks.map((c) => c.textContent).join('\n\n')
}

// Phase 4 (optional expansion, PRODUCT_PLAN.md §5): summarize the current
// document. Cached on the document row after first generation.
insightsRouter.post('/:id/summary', async (req, res) => {
  const document = await getAccessibleDocument(req.params.id, req.user!)
  if (!document) {
    res.status(404).json({ error: 'Document not found' })
    return
  }
  if (document.summary) {
    res.json({ summary: document.summary })
    return
  }

  try {
    const text = await fullTextFor(document.id)
    const summary = await summarizeDocument(text)
    await updateSummary(document.id, summary)
    res.json({ summary })
  } catch (err) {
    console.error('Summarization failed:', err)
    res.status(500).json({ error: 'Failed to summarize document.' })
  }
})

// Phase 4: simple Q&A grounded in the document text. Not persisted — each
// question is answered fresh from the full document context.
insightsRouter.post('/:id/qa', async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : ''
  if (!question) {
    res.status(400).json({ error: 'question is required' })
    return
  }

  const document = await getAccessibleDocument(req.params.id, req.user!)
  if (!document) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  try {
    const text = await fullTextFor(document.id)
    const answer = await answerQuestion(text, question)
    res.json({ answer })
  } catch (err) {
    console.error('Q&A failed:', err)
    res.status(500).json({ error: 'Failed to answer question.' })
  }
})
