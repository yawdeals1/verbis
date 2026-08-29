import { useEffect, useState } from 'react'
import { listDocumentShares, shareDocument, unshareDocument } from '../api/client'
import { TrashIcon } from './icons'

interface Share {
  id: string
  userId: string
  username?: string
}

export default function ShareDialog({
  documentId,
  documentTitle,
  onClose,
}: {
  documentId: string
  documentTitle: string
  onClose: () => void
}) {
  const [shares, setShares] = useState<Share[] | null>(null)
  const [username, setUsername] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listDocumentShares(documentId)
      .then((res) => setShares(res.shares))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load shares'))
  }, [documentId])

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = username.trim()
    if (!name) return

    setIsSubmitting(true)
    setError(null)
    try {
      const result = await shareDocument(documentId, name)
      setShares((current) => [...(current ?? []), { id: result.userId, userId: result.userId, username: result.username }])
      setUsername('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to share')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUnshare = async (userId: string) => {
    setShares((current) => current?.filter((s) => s.userId !== userId) ?? current)
    try {
      await unshareDocument(documentId, userId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove share')
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Share ${documentTitle}`}>
        <h2>Share "{documentTitle}"</h2>
        <p className="view-subtitle">Give another user read-only access by their username.</p>

        <form onSubmit={handleShare} style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <input
            className="input"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={isSubmitting || !username.trim()}>
            Share
          </button>
        </form>

        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}

        <ul className="share-list">
          {shares?.length === 0 && <li className="view-subtitle">Not shared with anyone yet.</li>}
          {shares?.map((s) => (
            <li key={s.userId}>
              <span>{s.username ?? s.userId}</span>
              <button
                type="button"
                className="btn btn-icon btn-danger-ghost"
                onClick={() => handleUnshare(s.userId)}
                aria-label={`Stop sharing with ${s.username ?? s.userId}`}
              >
                <TrashIcon width={14} height={14} />
              </button>
            </li>
          ))}
        </ul>

        <button type="button" className="btn btn-secondary btn-block" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}
