import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listDocuments } from '../api/client'
import type { Document } from '../api/types'

function statusLabel(document: Document): string {
  if (document.status === 'processing') return 'Processing…'
  if (document.status === 'error') return `Error: ${document.errorMessage ?? 'unknown'}`
  return document.lastPosition ? 'Reading in progress' : 'Ready'
}

export default function Library() {
  const [documents, setDocuments] = useState<Document[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listDocuments()
      .then((res) => setDocuments(res.documents))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load library'))
  }, [])

  return (
    <section>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Library</h1>
        <Link to="/import">+ Import</Link>
      </header>

      {error && <p role="alert">{error}</p>}
      {documents === null && !error && <p>Loading…</p>}
      {documents?.length === 0 && (
        <p>No documents yet. Import a PDF, DOCX, or scan a book page to get started.</p>
      )}

      <ul className="library-list">
        {documents?.map((doc) => (
          <li key={doc.id}>
            <Link to={`/reader/${doc.id}`}>
              <strong>{doc.title}</strong>
            </Link>
            <span className="library-item-meta">
              {doc.sourceType.toUpperCase()} · {statusLabel(doc)} · {new Date(doc.createdAt).toLocaleDateString()}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
