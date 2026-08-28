import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { deleteDocument, listDocuments } from '../api/client'
import type { Document } from '../api/types'
import { PlusIcon, TrashIcon } from '../components/icons'

// pdfjs-dist is a large dependency (~600kB) — load it only when a PDF tile
// actually needs to render a thumbnail, not on every Library visit.
const PdfThumbnail = lazy(() => import('../components/PdfThumbnail'))

function statusLabel(document: Document): string {
  if (document.status === 'processing') return 'Processing'
  if (document.status === 'error') return 'Error'
  if (document.chunksTotal > 0 && document.chunksReady < document.chunksTotal) {
    return `Generating audio ${document.chunksReady}/${document.chunksTotal}`
  }
  return 'Ready'
}

function statusBadgeClass(document: Document): string {
  if (document.status === 'processing') return 'badge-processing'
  if (document.status === 'error') return 'badge-error'
  if (document.chunksTotal > 0 && document.chunksReady < document.chunksTotal) return 'badge-processing'
  return 'badge-ready'
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
      <div className="view-header">
        <div>
          <h1>Library</h1>
          {documents && documents.length > 0 && (
            <p className="view-subtitle">
              {documents.length} document{documents.length === 1 ? '' : 's'}
            </p>
          )}
        </div>
        <Link to="/import" className="btn btn-primary">
          <PlusIcon width={16} height={16} />
          Import
        </Link>
      </div>

      {error && (
        <p role="alert" className="error-text" style={{ marginBottom: '1.25rem' }}>
          {error}
        </p>
      )}
      {documents === null && !error && <p className="view-subtitle">Loading your library…</p>}

      {documents?.length === 0 && (
        <div className="empty-state">
          <h2>Nothing here yet</h2>
          <p>Import a PDF or DOCX, or scan a page from a physical book, and it'll show up here ready to listen to.</p>
          <Link to="/import" className="btn btn-primary">
            <PlusIcon width={16} height={16} />
            Import your first document
          </Link>
        </div>
      )}

      <ul className="library-grid">
        {documents?.map((doc) => {
          const progress =
            doc.chunksTotal > 0 ? Math.round((doc.chunksReady / doc.chunksTotal) * 100) : doc.status === 'ready' ? 100 : 0
          return (
            <li className="library-card" key={doc.id}>
              <Link to={`/reader/${doc.id}`} className={`library-card-tile status-${statusClass(doc)}`}>
                {doc.sourceType === 'pdf' ? (
                  <Suspense fallback={<span className="library-card-tile-type">PDF</span>}>
                    <PdfThumbnail documentId={doc.id} />
                  </Suspense>
                ) : (
                  <span className="library-card-tile-type">{doc.sourceType.toUpperCase()}</span>
                )}
              </Link>
              <div className="library-card-info">
                <div className="library-card-title-row">
                  <Link to={`/reader/${doc.id}`} className="library-card-title">
                    {doc.title}
                  </Link>
                  <button
                    type="button"
                    className="btn btn-icon btn-danger-ghost library-card-delete"
                    onClick={() => handleDelete(doc)}
                    disabled={deletingId === doc.id}
                    aria-label={`Delete ${doc.title}`}
                    title="Delete"
                  >
                    <TrashIcon width={14} height={14} />
                  </button>
                </div>
                <span className={`badge ${statusBadgeClass(doc)}`}>
                  <span className="badge-dot" />
                  {statusLabel(doc)}
                </span>
                {progress > 0 && progress < 100 && (
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                )}
                <p className="library-card-meta">{new Date(doc.createdAt).toLocaleDateString()}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
