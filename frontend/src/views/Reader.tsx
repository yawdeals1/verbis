import { useParams } from 'react-router-dom'
import { useReaderPlayback } from '../hooks/useReaderPlayback'
import { useHighlightGranularity } from '../hooks/useHighlightGranularity'
import ChunkText from '../components/ChunkText'
import PlaybackBar from '../components/PlaybackBar'
import DocumentInsights from '../components/DocumentInsights'

export default function Reader() {
  const { documentId } = useParams<{ documentId: string }>()
  const [granularity, setGranularity] = useHighlightGranularity()
  const {
    detail,
    loadError,
    audioRef,
    chunkIndex,
    currentChunk,
    wordIndex,
    isPlaying,
    playbackRate,
    currentTime,
    duration,
    handlers,
    actions,
  } = useReaderPlayback(documentId)

  if (loadError) {
    return (
      <section>
        <p role="alert">Couldn't load this document: {loadError}</p>
      </section>
    )
  }

  if (!detail) {
    return (
      <section>
        <p>Loading…</p>
      </section>
    )
  }

  const { document, chunks } = detail

  return (
    <section className="reader">
      <header>
        <h1>{document.title}</h1>
        <p className="reader-meta">
          Chunk {chunkIndex + 1} of {chunks.length}
        </p>
      </header>

      {document.status === 'error' && (
        <p role="alert">Something went wrong generating audio: {document.errorMessage}</p>
      )}
      {document.status === 'processing' && <p>Preparing your document…</p>}
      {currentChunk?.status === 'pending' && document.status !== 'processing' && (
        <p>Generating audio for this section…</p>
      )}

      <div className="reader-settings">
        <label>
          Highlight
          <select value={granularity} onChange={(e) => setGranularity(e.target.value as typeof granularity)}>
            <option value="word">Word</option>
            <option value="sentence">Sentence</option>
            <option value="off">Off</option>
          </select>
        </label>
      </div>

      <ChunkText
        chunk={currentChunk}
        activeWordIndex={wordIndex}
        granularity={granularity}
        onWordTap={actions.jumpToWord}
      />

      <audio
        ref={audioRef}
        onLoadedMetadata={handlers.handleLoadedMetadata}
        onTimeUpdate={handlers.handleTimeUpdate}
        onEnded={handlers.handleEnded}
        style={{ display: 'none' }}
      />

      <PlaybackBar
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        playbackRate={playbackRate}
        hasNextChunk={chunkIndex < chunks.length - 1}
        hasPrevChunk={chunkIndex > 0}
        onTogglePlay={actions.togglePlay}
        onSkip={actions.skip}
        onSeek={(seconds) => {
          if (audioRef.current) audioRef.current.currentTime = seconds
        }}
        onSetPlaybackRate={actions.setPlaybackRate}
      />

      {documentId && document.status === 'ready' && <DocumentInsights documentId={documentId} />}
    </section>
  )
}
