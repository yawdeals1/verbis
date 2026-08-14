import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { deleteDocument, listDocuments } from '../api/client'
import type { Document } from '../api/types'

function statusLabel(document: Document): string {
  if (document.status === 'processing') return 'Processing…'
  if (document.status === 'error') return `Error: ${document.errorMessage ?? 'unknown'}`
  return document.lastPosition ? 'Reading in progress' : 'Ready'
}

function statusClass(document: Document): string {
  if (document.status === 'processing') return 'processing'
  if (document.status === 'error') return 'error'
  return 'ready'
}

export default function Library() {
  const [documents, setDocuments] = useState<Document[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    listDocuments()
      .then((res) => setDocuments(res.documents))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load library'))
  }, [])

  const handleDelete = async (doc: Document) => {
    if (!window.confirm(`Delete "${doc.title}"? This permanently removes it and its generated audio.`)) return

    setDeletingId(doc.id)
    try {
      await deleteDocument(doc.id)
      setDocuments((docs) => docs?.filter((d) => d.id !== doc.id) ?? docs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete document')
    } finally {
      setDeletingId(null)
    }
  }

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

      <div className="library-grid">
        {documents?.map((doc) => (
          <div className="library-card" key={doc.id}>
            <Link to={`/reader/${doc.id}`} className={`library-card-tile status-${statusClass(doc)}`}>
              <span className="library-card-tile-type">{doc.sourceType.toUpperCase()}</span>
            </Link>
            <div className="library-card-info">
              <Link to={`/reader/${doc.id}`} className="library-card-title">
                {doc.title}
              </Link>
              <p className="library-card-meta">{statusLabel(doc)}</p>
              <p className="library-card-meta">{new Date(doc.createdAt).toLocaleDateString()}</p>
              <button
                type="button"
                className="library-card-delete"
                onClick={() => handleDelete(doc)}
                disabled={deletingId === doc.id}
              >
                {deletingId === doc.id ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
