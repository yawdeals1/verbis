import { lazy, Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { useReaderPlayback } from '../hooks/useReaderPlayback'
import { useHighlightGranularity } from '../hooks/useHighlightGranularity'
import { useLocalStorageState } from '../hooks/useLocalStorageState'
import ChunkText from '../components/ChunkText'
import PlaybackBar from '../components/PlaybackBar'
import DocumentInsights from '../components/DocumentInsights'

// pdfjs-dist is a large dependency (~600kB) — load it only when a PDF's
// Page view is actually opened, not on every route in the app.
const PdfPageView = lazy(() => import('../components/PdfPageView'))

type ReaderView = 'text' | 'page'

export default function Reader() {
  const { documentId } = useParams<{ documentId: string }>()
  const [granularity, setGranularity] = useHighlightGranularity()
  const [view, setView] = useLocalStorageState<ReaderView>('verbis:reader-view', 'page')
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
    mergedMode,
    isMerging,
    mergeError,
    canMerge,
    mergedComplete,
    isBufferingMore,
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
  const readyCount = chunks.filter((c) => c.status === 'ready').length
  const canShowPageView = document.sourceType === 'pdf' && document.pageLayout !== null
  const activeView: ReaderView = canShowPageView ? view : 'text'

  return (
    <section className="reader">
      <header>
        <h1>{document.title}</h1>
        {chunks.length > 0 && (
          <p className="reader-meta">
            Chunk {chunkIndex + 1} of {chunks.length}
          </p>
        )}
      </header>

      {document.status === 'error' && <p role="alert">Something went wrong: {document.errorMessage}</p>}
      {document.status === 'processing' && chunks.length === 0 && <p>Extracting text and preparing your document…</p>}
      {document.status === 'processing' && chunks.length > 0 && (
        <p>
          Generating audio… {readyCount} of {chunks.length} sections ready
        </p>
      )}
      {document.status === 'ready' && currentChunk?.status === 'pending' && (
        <p>
          Generating audio for this section… ({readyCount} of {chunks.length} sections ready)
        </p>
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

        {canShowPageView && (
          <div className="view-toggle" role="group" aria-label="Reader view">
            <button type="button" className={activeView === 'page' ? 'active' : ''} onClick={() => setView('page')}>
              Page
            </button>
            <button type="button" className={activeView === 'text' ? 'active' : ''} onClick={() => setView('text')}>
              Text
            </button>
          </div>
        )}

        {!mergedMode && (
          <button
            type="button"
            className="merge-button"
            onClick={actions.mergeAudio}
            disabled={!canMerge || isMerging}
            title={canMerge ? undefined : 'The first section needs to finish generating first'}
          >
            {isMerging ? 'Merging…' : 'Merge all sections'}
          </button>
        )}
        {mergedMode && (
          <span className="reader-meta">
            {mergedComplete
              ? 'Playing as one continuous file'
              : isBufferingMore
                ? 'Playing as one continuous file (waiting on the next section…)'
                : 'Playing as one continuous file (still generating more…)'}
          </span>
        )}
      </div>
      {mergeError && <p role="alert">{mergeError}</p>}

      {activeView === 'page' && document.pageLayout ? (
        <Suspense fallback={<p>Loading page previews…</p>}>
          <PdfPageView
            documentId={document.id}
            pageLayout={document.pageLayout}
            chunks={chunks}
            activeChunkIndex={chunkIndex}
            activeWordIndex={wordIndex}
            onWordTap={actions.jumpToWord}
          />
        </Suspense>
      ) : (
        <ChunkText
          chunks={chunks}
          activeChunkIndex={chunkIndex}
          activeWordIndex={wordIndex}
          granularity={granularity}
          onWordTap={actions.jumpToWord}
        />
      )}

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
        onPrevChunk={actions.goToPrevChunk}
        onNextChunk={actions.goToNextChunk}
        onSeek={(seconds) => {
          if (audioRef.current) audioRef.current.currentTime = seconds
        }}
        onSetPlaybackRate={actions.setPlaybackRate}
      />

      {documentId && document.status === 'ready' && <DocumentInsights documentId={documentId} />}
    </section>
  )
}
