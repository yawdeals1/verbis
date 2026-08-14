import { useState } from 'react'
import { askQuestion, getSummary } from '../api/client'

// Phase 4 (optional expansion, PRODUCT_PLAN.md §5): on-demand summary and
// document-grounded Q&A. Deliberately request-triggered, not automatic —
// these call a metered LLM API per PRODUCT_PLAN.md's cost-control guidance.
export default function DocumentInsights({ documentId }: { documentId: string }) {
  const [summary, setSummary] = useState<string | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [qaLoading, setQaLoading] = useState(false)
  const [qaError, setQaError] = useState<string | null>(null)

  const handleSummarize = async () => {
    setSummaryLoading(true)
    setSummaryError(null)
    try {
      const result = await getSummary(documentId)
      setSummary(result.summary)
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Failed to summarize')
    } finally {
      setSummaryLoading(false)
    }
  }

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!question.trim()) return
    setQaLoading(true)
    setQaError(null)
    try {
      const result = await askQuestion(documentId, question.trim())
      setAnswer(result.answer)
    } catch (err) {
      setQaError(err instanceof Error ? err.message : 'Failed to get an answer')
    } finally {
      setQaLoading(false)
    }
  }

  return (
    <details className="document-insights">
      <summary>Summarize &amp; ask questions</summary>

      <div>
        <button type="button" onClick={handleSummarize} disabled={summaryLoading}>
          {summaryLoading ? 'Summarizing…' : summary ? 'Regenerate summary' : 'Summarize this document'}
        </button>
        {summaryError && <p role="alert">{summaryError}</p>}
        {summary && <p>{summary}</p>}
      </div>

      <form onSubmit={handleAsk}>
        <label>
          Ask a question about this document
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What does this document say about…" />
        </label>
        <button type="submit" disabled={qaLoading || !question.trim()}>
          {qaLoading ? 'Thinking…' : 'Ask'}
        </button>
        {qaError && <p role="alert">{qaError}</p>}
        {answer && <p>{answer}</p>}
      </form>
    </details>
  )
}
