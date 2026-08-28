import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { importUrl, listVoices, uploadDocument, uploadScan } from '../api/client'
import type { Voice } from '../api/types'
import { CameraIcon, LinkIcon, UploadIcon } from '../components/icons'

type Mode = 'file' | 'scan' | 'url'

const MODES: { id: Mode; label: string }[] = [
  { id: 'file', label: 'File' },
  { id: 'scan', label: 'Scan a page' },
  { id: 'url', label: 'Web page' },
]

export default function Import() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('file')
  const [voices, setVoices] = useState<Voice[]>([])
  const [voiceId, setVoiceId] = useState<string>('')
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [scanTitle, setScanTitle] = useState('')
  const [url, setUrl] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listVoices()
      .then((res) => {
        setVoices(res.voices)
        if (res.voices.length > 0) setVoiceId(res.voices[0].id)
      })
      .catch(() => {
        // Voice list is a nice-to-have at import time; the backend falls back
        // to a default voice server-side if none is supplied.
      })
  }, [])

  useEffect(() => {
    previewAudioRef.current?.pause()
    setPreviewingVoiceId(null)
  }, [voiceId])

  useEffect(() => {
    setFile(null)
    setError(null)
  }, [mode])

  const selectedVoice = voices.find((v) => v.id === voiceId)

  const togglePreview = () => {
    const audio = previewAudioRef.current
    if (!audio || !selectedVoice?.previewAudioUrl) return

    if (previewingVoiceId === selectedVoice.id) {
      audio.pause()
      setPreviewingVoiceId(null)
      return
    }

    audio.src = selectedVoice.previewAudioUrl
    audio.play().catch(() => {})
    setPreviewingVoiceId(selectedVoice.id)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (mode !== 'url' && !file) {
      setError('Choose a file first.')
      return
    }
    if (mode === 'url' && !url.trim()) {
      setError('Paste a URL first.')
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      const { document } =
        mode === 'file'
          ? await uploadDocument(file!, voiceId || undefined)
          : mode === 'scan'
            ? await uploadScan(file!, { voiceId: voiceId || undefined, title: scanTitle || undefined })
            : await importUrl(url.trim(), voiceId || undefined)
      navigate(`/reader/${document.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="import-panel">
      <div>
        <h1>Import</h1>
        <p className="view-subtitle">Bring in a document and start listening in a few seconds.</p>
      </div>

      <div className="segmented" role="tablist" aria-label="Import method">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} className={mode === m.id ? 'active' : ''} onClick={() => setMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>

      <form className="import-form" onSubmit={handleSubmit}>
        {mode === 'file' && (
          <div className="field">
            <span className="field-label">File</span>
            <label className="dropzone">
              <input type="file" accept=".pdf,.docx,.txt,.epub" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <UploadIcon width={26} height={26} className="dropzone-icon" />
              <span className="dropzone-title">{file ? 'Change file' : 'Click to choose a file'}</span>
              <span className="dropzone-hint">PDF, DOCX, TXT, or EPUB</span>
              {file && <span className="dropzone-filename">{file.name}</span>}
            </label>
          </div>
        )}

        {mode === 'scan' && (
          <>
            <div className="field">
              <span className="field-label">Photo</span>
              <label className="dropzone">
                <input type="file" accept="image/*" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <CameraIcon width={26} height={26} className="dropzone-icon" />
                <span className="dropzone-title">{file ? 'Change photo' : 'Take or upload a photo'}</span>
                <span className="dropzone-hint">A single page, well lit, held flat</span>
                {file && <span className="dropzone-filename">{file.name}</span>}
              </label>
            </div>
            <label className="field">
              <span className="field-label">Title (optional)</span>
              <input className="input" value={scanTitle} onChange={(e) => setScanTitle(e.target.value)} placeholder="Scanned page" />
            </label>
          </>
        )}

        {mode === 'url' && (
          <label className="field">
            <span className="field-label">Page URL</span>
            <div style={{ position: 'relative' }}>
              <LinkIcon
                width={15}
                height={15}
                style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
              />
              <input
                className="input"
                style={{ paddingLeft: '2.1rem' }}
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/article"
              />
            </div>
          </label>
        )}

        {voices.length > 0 && (
          <div className="voice-picker">
            <label className="field">
              <span className="field-label">Voice</span>
              <select className="input" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                {voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.displayName}
                  </option>
                ))}
              </select>
            </label>
            {selectedVoice?.previewAudioUrl && (
              <button type="button" className="btn btn-secondary" onClick={togglePreview}>
                {previewingVoiceId === selectedVoice.id ? 'Stop' : 'Preview'}
              </button>
            )}
            <audio ref={previewAudioRef} onEnded={() => setPreviewingVoiceId(null)} style={{ display: 'none' }} />
          </div>
        )}

        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={isSubmitting || (mode === 'url' ? !url.trim() : !file)}>
          {isSubmitting ? 'Processing…' : 'Import and start listening'}
        </button>
      </form>
    </section>
  )
}
