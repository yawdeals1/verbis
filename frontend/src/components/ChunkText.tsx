import { useMemo } from 'react'
import type { ChunkSummary } from '../api/types'
import type { HighlightGranularity } from '../hooks/useHighlightGranularity'
import { computeSentenceGroups } from '../utils/sentenceGroups'

interface Props {
  chunk: ChunkSummary | undefined
  activeWordIndex: number | null
  granularity: HighlightGranularity
  onWordTap: (wordIndex: number) => void
}

/** Memoized wrapper around computeSentenceGroups, for 'sentence' granularity highlighting. */
function useSentenceGroups(words: { word: string }[] | undefined): number[] {
  return useMemo(() => (words ? computeSentenceGroups(words) : []), [words])
}

/**
 * Renders the current chunk's text. When timing data is available, each
 * word is its own tappable span (tap-to-jump, PRODUCT_PLAN.md §3) — tapping
 * always works regardless of highlight granularity. The highlight itself
 * can span the current word, its whole sentence, or be switched off
 * (PRODUCT_PLAN.md §5, adjustable highlight granularity).
 */
export default function ChunkText({ chunk, activeWordIndex, granularity, onWordTap }: Props) {
  const sentenceGroups = useSentenceGroups(chunk?.timingData?.words)

  if (!chunk) return null

  if (!chunk.timingData) {
    return (
      <div className="chunk-text" aria-live="off">
        {chunk.textContent}
      </div>
    )
  }

  const isActive = (index: number): boolean => {
    if (granularity === 'off' || activeWordIndex === null) return false
    if (granularity === 'word') return index === activeWordIndex
    return sentenceGroups[index] === sentenceGroups[activeWordIndex]
  }

  return (
    <div className="chunk-text">
      {chunk.timingData.words.map((word, index) => (
        <span key={index}>
          <span
            role="button"
            tabIndex={0}
            className={isActive(index) ? 'word word-active' : 'word'}
            onClick={() => onWordTap(index)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onWordTap(index)
            }}
          >
            {word.word}
          </span>{' '}
        </span>
      ))}
    </div>
  )
}
