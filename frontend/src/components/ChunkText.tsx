import { useEffect, useMemo, useRef } from 'react'
import type { ChunkSummary, WordTiming } from '../api/types'
import type { HighlightGranularity } from '../hooks/useHighlightGranularity'
import { computeSentenceGroups } from '../utils/sentenceGroups'

interface Props {
  chunks: ChunkSummary[]
  activeChunkIndex: number
  activeWordIndex: number | null
  granularity: HighlightGranularity
  onWordTap: (chunkIndex: number, wordIndex: number) => void
}

/** Buckets a chunk's word timings back into paragraphs using the "\n\n" markers chunking.ts preserves in textContent. */
function splitWordsIntoParagraphs(text: string, words: WordTiming[]): WordTiming[][] {
  const boundaries: number[] = []
  const paragraphBreak = /\n{2,}/g
  let match: RegExpExecArray | null
  while ((match = paragraphBreak.exec(text))) boundaries.push(match.index)

  const paragraphs: WordTiming[][] = [[]]
  let boundaryIndex = 0
  for (const word of words) {
    while (boundaryIndex < boundaries.length && word.charStart >= boundaries[boundaryIndex]) {
      paragraphs.push([])
      boundaryIndex++
    }
    paragraphs[paragraphs.length - 1].push(word)
  }
  return paragraphs.filter((p) => p.length > 0)
}

/** A chunk whose audio hasn't generated yet — its text is already known, so show it, just not tappable/timed. */
function PendingChunk({ chunk }: { chunk: ChunkSummary }) {
  const paragraphs = chunk.textContent.split(/\n{2,}/).filter(Boolean)
  return (
    <div className={`chunk-block chunk-block-pending${chunk.status === 'error' ? ' chunk-block-error' : ''}`}>
      {paragraphs.map((paragraph, i) => (
        <p key={i}>{paragraph}</p>
      ))}
    </div>
  )
}

function ReadyChunk({
  chunk,
  isActive,
  activeWordIndex,
  granularity,
  onWordTap,
}: {
  chunk: ChunkSummary
  isActive: boolean
  activeWordIndex: number | null
  granularity: HighlightGranularity
  onWordTap: (wordIndex: number) => void
}) {
  const words = chunk.timingData!.words
  const paragraphs = useMemo(() => splitWordsIntoParagraphs(chunk.textContent, words), [chunk.textContent, words])
  const sentenceGroups = useMemo(() => computeSentenceGroups(words), [words])
  const activeWordRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (isActive && activeWordIndex !== null) {
      activeWordRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isActive, activeWordIndex])

  const isWordActive = (index: number): boolean => {
    if (!isActive || granularity === 'off' || activeWordIndex === null) return false
    if (granularity === 'word') return index === activeWordIndex
    return sentenceGroups[index] === sentenceGroups[activeWordIndex]
  }

  let globalIndex = 0
  return (
    <div className={`chunk-block ${isActive ? 'chunk-block-active' : 'chunk-block-inactive'}`}>
      {paragraphs.map((paragraph, pIndex) => (
        <p key={pIndex}>
          {paragraph.map((word) => {
            const index = globalIndex++
            const active = isWordActive(index)
            return (
              <span key={index}>
                <span
                  ref={active ? activeWordRef : undefined}
                  role="button"
                  tabIndex={0}
                  className={active ? 'word word-active' : 'word'}
                  onClick={() => onWordTap(index)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onWordTap(index)
                  }}
                >
                  {word.word}
                </span>{' '}
              </span>
            )
          })}
        </p>
      ))}
    </div>
  )
}

/**
 * Renders the full document as a continuous, scrollable flow — every chunk's
 * text is known as soon as the document is created (only audio lags behind),
 * so there's no reason to show just one chunk at a time. Ready chunks are
 * word-tappable (tap-to-jump, PRODUCT_PLAN.md §3, now able to target any
 * generated chunk, not only the currently playing one); chunks still
 * generating render as plain, dimmed paragraphs.
 */
export default function ChunkText({ chunks, activeChunkIndex, activeWordIndex, granularity, onWordTap }: Props) {
  if (chunks.length === 0) return null

  return (
    <div className="chunk-text">
      {chunks.map((chunk, index) =>
        chunk.timingData ? (
          <ReadyChunk
            key={chunk.id}
            chunk={chunk}
            isActive={index === activeChunkIndex}
            activeWordIndex={activeWordIndex}
            granularity={granularity}
            onWordTap={(wordIndex) => onWordTap(index, wordIndex)}
          />
        ) : (
          <PendingChunk key={chunk.id} chunk={chunk} />
        ),
      )}
    </div>
  )
}
