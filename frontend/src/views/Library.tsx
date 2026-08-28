import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  addDocumentToFolder,
  createFolder,
  deleteDocument,
  deleteFolder,
  listDocuments,
  listFolders,
  removeDocumentFromFolder,
  renameFolder,
} from '../api/client'
import type { Document, Folder } from '../api/types'
import { CheckIcon, FolderIcon, PlusIcon, TrashIcon } from '../components/icons'

// pdfjs-dist is a large dependency (~600kB) — load it only when a PDF tile
// actually needs to render a thumbnail, not on every Library visit.
const PdfThumbnail = lazy(() => import('../components/PdfThumbnail'))

const UNFILED = 'unfiled'
const ALL = 'all'
type FolderFilter = typeof ALL | typeof UNFILED | string

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
  const [folders, setFolders] = useState<Folder[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<FolderFilter>(ALL)

  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [savingFolder, setSavingFolder] = useState(false)
  const newFolderInputRef = useRef<HTMLInputElement | null>(null)

  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    listDocuments()
      .then((res) => setDocuments(res.documents))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load library'))
    listFolders()
      .then((res) => setFolders(res.folders))
      .catch(() => {
        // Folder list is secondary to the document grid — a failure here
        // just means the filter bar shows no folders, not a hard error.
      })
  }, [])

  useEffect(() => {
    if (isCreatingFolder) newFolderInputRef.current?.focus()
  }, [isCreatingFolder])

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

  const handleToggleFolder = async (doc: Document, folderId: string) => {
    const wasInFolder = doc.folderIds.includes(folderId)
    const nextFolderIds = wasInFolder ? doc.folderIds.filter((id) => id !== folderId) : [...doc.folderIds, folderId]
    setDocuments((docs) => docs?.map((d) => (d.id === doc.id ? { ...d, folderIds: nextFolderIds } : d)) ?? docs)
    try {
      if (wasInFolder) await removeDocumentFromFolder(doc.id, folderId)
      else await addDocumentToFolder(doc.id, folderId)
    } catch (err) {
      setDocuments((docs) => docs?.map((d) => (d.id === doc.id ? { ...d, folderIds: doc.folderIds } : d)) ?? docs)
      setError(err instanceof Error ? err.message : 'Failed to update folders')
    }
  }

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newFolderName.trim()
    if (!name) return

    setSavingFolder(true)
    try {
      const { folder } = await createFolder(name)
      setFolders((current) => [...(current ?? []), folder].sort((a, b) => a.name.localeCompare(b.name)))
      setActiveFilter(folder.id)
      setNewFolderName('')
      setIsCreatingFolder(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create folder')
    } finally {
      setSavingFolder(false)
    }
  }

  const cancelledRenameRef = useRef(false)

  const commitRenameFolder = async (folder: Folder) => {
    setRenamingFolderId(null)
    if (cancelledRenameRef.current) {
      cancelledRenameRef.current = false
      return
    }

    const name = renameValue.trim()
    if (!name || name === folder.name) return

    try {
      const { folder: updated } = await renameFolder(folder.id, name)
      setFolders((current) => current?.map((f) => (f.id === folder.id ? updated : f)).sort((a, b) => a.name.localeCompare(b.name)) ?? current)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename folder')
    }
  }

  const handleDeleteFolder = async (folder: Folder) => {
    if (!window.confirm(`Delete "${folder.name}"? Documents inside stay in your library, unfiled.`)) return

    try {
      await deleteFolder(folder.id)
      setFolders((current) => current?.filter((f) => f.id !== folder.id) ?? current)
      setDocuments(
        (docs) => docs?.map((d) => (d.folderIds.includes(folder.id) ? { ...d, folderIds: d.folderIds.filter((id) => id !== folder.id) } : d)) ?? docs,
      )
      setActiveFilter((current) => (current === folder.id ? ALL : current))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete folder')
    }
  }

  const filteredDocuments =
    activeFilter === ALL
      ? documents
      : activeFilter === UNFILED
        ? documents?.filter((d) => d.folderIds.length === 0)
        : documents?.filter((d) => d.folderIds.includes(activeFilter))

  const activeFolder = folders?.find((f) => f.id === activeFilter) ?? null

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

      {documents && documents.length > 0 && (
        <div className="folder-bar" role="tablist" aria-label="Filter by folder">
          <button type="button" role="tab" aria-selected={activeFilter === ALL} className={`folder-pill${activeFilter === ALL ? ' active' : ''}`} onClick={() => setActiveFilter(ALL)}>
            All
          </button>
          {(folders?.length ?? 0) > 0 && (
            <button
              type="button"
              role="tab"
              aria-selected={activeFilter === UNFILED}
              className={`folder-pill${activeFilter === UNFILED ? ' active' : ''}`}
              onClick={() => setActiveFilter(UNFILED)}
            >
              Unfiled
            </button>
          )}

          {folders?.map((folder) => {
            const count = documents.filter((d) => d.folderIds.includes(folder.id)).length
            if (renamingFolderId === folder.id) {
              return (
                <input
                  key={folder.id}
                  className="input folder-rename-input"
                  value={renameValue}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => commitRenameFolder(folder)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      cancelledRenameRef.current = true
                      e.currentTarget.blur()
                    } else if (e.key === 'Enter') {
                      e.currentTarget.blur()
                    }
                  }}
                />
              )
            }
            return (
              <span className="folder-chip" key={folder.id}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeFilter === folder.id}
                  className={`folder-pill${activeFilter === folder.id ? ' active' : ''}`}
                  onClick={() => setActiveFilter(folder.id)}
                  onDoubleClick={() => {
                    setRenamingFolderId(folder.id)
                    setRenameValue(folder.name)
                  }}
                  title="Double-click to rename"
                >
                  <FolderIcon width={13} height={13} />
                  {folder.name}
                  <span className="folder-pill-count">{count}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-icon btn-danger-ghost folder-chip-delete"
                  onClick={() => handleDeleteFolder(folder)}
                  aria-label={`Delete folder ${folder.name}`}
                  title="Delete folder"
                >
                  <TrashIcon width={12} height={12} />
                </button>
              </span>
            )
          })}

          {isCreatingFolder ? (
            <form className="folder-new-form" onSubmit={handleCreateFolder}>
              <input
                ref={newFolderInputRef}
                className="input folder-new-input"
                value={newFolderName}
                placeholder="Folder name"
                disabled={savingFolder}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setIsCreatingFolder(false)
                    setNewFolderName('')
                  }
                }}
                onBlur={() => {
                  if (!newFolderName.trim()) setIsCreatingFolder(false)
                }}
              />
            </form>
          ) : (
            <button type="button" className="folder-pill folder-pill-new" onClick={() => setIsCreatingFolder(true)}>
              <PlusIcon width={13} height={13} />
              New folder
            </button>
          )}
        </div>
      )}

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

      {documents && documents.length > 0 && filteredDocuments?.length === 0 && (
        <p className="view-subtitle" style={{ padding: '1.5rem 0' }}>
          {activeFolder ? `No documents in "${activeFolder.name}" yet — move some here from another folder.` : 'No unfiled documents.'}
        </p>
      )}

      <ul className="library-grid">
        {filteredDocuments?.map((doc) => {
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
                {folders && folders.length > 0 && (
                  <FolderPicker doc={doc} folders={folders} onToggleFolder={(folderId) => handleToggleFolder(doc, folderId)} />
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

function FolderPicker({
  doc,
  folders,
  onToggleFolder,
}: {
  doc: Document
  folders: Folder[]
  onToggleFolder: (folderId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const selectedNames = folders.filter((f) => doc.folderIds.includes(f.id)).map((f) => f.name)
  const triggerLabel =
    selectedNames.length === 0 ? 'Add to folder' : selectedNames.length === 1 ? selectedNames[0] : `${selectedNames.length} folders`

  return (
    <div className="folder-picker" ref={containerRef}>
      <button
        type="button"
        className={`folder-picker-trigger${selectedNames.length > 0 ? ' has-folders' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Add ${doc.title} to a folder`}
        title="Add to folder"
      >
        {selectedNames.length > 0 ? <FolderIcon width={12} height={12} /> : <PlusIcon width={12} height={12} />}
        <span className="folder-picker-trigger-label">{triggerLabel}</span>
      </button>
      {open && (
        <div className="folder-picker-panel" role="menu" aria-label={`Folders for ${doc.title}`}>
          {folders.map((folder) => {
            const checked = doc.folderIds.includes(folder.id)
            return (
              <button
                type="button"
                key={folder.id}
                role="menuitemcheckbox"
                aria-checked={checked}
                className="folder-picker-option"
                onClick={() => onToggleFolder(folder.id)}
              >
                <span className={`folder-picker-check${checked ? ' checked' : ''}`}>
                  {checked && <CheckIcon width={11} height={11} />}
                </span>
                {folder.name}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
