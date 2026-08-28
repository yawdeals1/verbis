import { useState } from 'react'
import { askQuestion, getSummary } from '../api/client'
import { ChevronDownIcon, SparkleIcon } from './icons'

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
      <summary>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
          <SparkleIcon width={15} height={15} style={{ color: 'var(--accent)' }} />
          Summarize &amp; ask questions
        </span>
        <ChevronDownIcon className="chevron" width={16} height={16} />
      </summary>

      <div className="document-insights-body">
        <div className="field">
          <button type="button" className="btn btn-secondary" onClick={handleSummarize} disabled={summaryLoading} style={{ alignSelf: 'flex-start' }}>
            {summaryLoading ? 'Summarizing…' : summary ? 'Regenerate summary' : 'Summarize this document'}
          </button>
          {summaryError && (
            <p role="alert" className="error-text">
              {summaryError}
            </p>
          )}
          {summary && <p className="insight-result">{summary}</p>}
        </div>

        <form onSubmit={handleAsk}>
          <label className="field">
            <span className="field-label">Ask a question about this document</span>
            <input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What does this document say about…" />
          </label>
          <button type="submit" className="btn btn-secondary" disabled={qaLoading || !question.trim()}>
            {qaLoading ? 'Thinking…' : 'Ask'}
          </button>
        </form>
        {qaError && (
          <p role="alert" className="error-text">
            {qaError}
          </p>
        )}
        {answer && <p className="insight-result">{answer}</p>}
      </div>
    </details>
  )
}
