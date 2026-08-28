import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { importUrl, listVoices, uploadDocument, uploadScan } from '../api/client'
import type { Voice } from '../api/types'

type Mode = 'file' | 'scan' | 'url'

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
    <section>
      <h1>Import</h1>

      <div role="tablist">
        <button type="button" aria-pressed={mode === 'file'} onClick={() => setMode('file')}>
          Upload PDF / DOCX / TXT / EPUB
        </button>
        <button type="button" aria-pressed={mode === 'scan'} onClick={() => setMode('scan')}>
          Scan a book page
        </button>
        <button type="button" aria-pressed={mode === 'url'} onClick={() => setMode('url')}>
          Import from a web page
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        {mode === 'file' && (
          <label>
            File
            <input
              type="file"
              accept=".pdf,.docx,.txt,.epub"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        )}

        {mode === 'scan' && (
          <>
            <label>
              Photo (camera or upload)
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <label>
              Title (optional)
              <input value={scanTitle} onChange={(e) => setScanTitle(e.target.value)} placeholder="Scanned page" />
            </label>
          </>
        )}

        {mode === 'url' && (
          <label>
            Page URL
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/article"
            />
          </label>
        )}

        {voices.length > 0 && (
          <div className="voice-picker">
            <label>
              Voice
              <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                {voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.displayName}
                  </option>
                ))}
              </select>
            </label>
            {selectedVoice?.previewAudioUrl && (
              <button type="button" onClick={togglePreview}>
                {previewingVoiceId === selectedVoice.id ? 'Stop preview' : 'Preview voice'}
              </button>
            )}
            <audio
              ref={previewAudioRef}
              onEnded={() => setPreviewingVoiceId(null)}
              style={{ display: 'none' }}
            />
          </div>
        )}

        {error && <p role="alert">{error}</p>}

        <button type="submit" disabled={isSubmitting || (mode === 'url' ? !url.trim() : !file)}>
          {isSubmitting ? 'Processing…' : 'Import and start listening'}
        </button>
      </form>
    </section>
  )
}
