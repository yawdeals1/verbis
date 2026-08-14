import { useCallback, useEffect, useRef, useState } from 'react'
import { chunkAudioUrl, getDocument, updatePosition } from '../api/client'
import type { ChunkSummary, DocumentDetail } from '../api/types'

const POLL_INTERVAL_MS = 2000
const POSITION_SAVE_INTERVAL_MS = 5000

/** Finds the word whose [startMs, endMs) window contains `timeMs`. Chunks are short enough that a linear scan is fine. */
function findWordIndex(chunk: ChunkSummary | undefined, timeMs: number): number | null {
  if (!chunk?.timingData) return null
  const { words } = chunk.timingData
  for (let i = 0; i < words.length; i++) {
    if (timeMs >= words[i].startMs && timeMs < words[i].endMs) return i
  }
  // Between words (silence/punctuation gap) — highlight the most recently started word.
  for (let i = words.length - 1; i >= 0; i--) {
    if (timeMs >= words[i].startMs) return i
  }
  return null
}

export function useReaderPlayback(documentId: string | undefined) {
  const [detail, setDetail] = useState<DocumentDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [chunkIndex, setChunkIndex] = useState(0)
  const [wordIndex, setWordIndex] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackRate, setPlaybackRateState] = useState(1)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const hasAppliedResumeRef = useRef(false)
  const pendingSeekSecondsRef = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    if (!documentId) return
    const data = await getDocument(documentId)
    setDetail(data)
    return data
  }, [documentId])

  // Initial load + apply saved reading position once.
  useEffect(() => {
    if (!documentId) return
    let cancelled = false

    getDocument(documentId)
      .then((data) => {
        if (cancelled) return
        setDetail(data)
        if (!hasAppliedResumeRef.current && data.document.lastPosition) {
          hasAppliedResumeRef.current = true
          setChunkIndex(data.document.lastPosition.chunkSequenceIndex)
          pendingSeekSecondsRef.current = data.document.lastPosition.timeSeconds
        }
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load document')
      })

    return () => {
      cancelled = true
    }
  }, [documentId])

  const currentChunk = detail?.chunks[chunkIndex]

  // Poll while the current (or document) generation is still in progress.
  useEffect(() => {
    if (!documentId || !detail) return
    const stillGenerating =
      detail.document.status === 'processing' || (currentChunk && currentChunk.status === 'pending')
    if (!stillGenerating) return

    const interval = setInterval(() => {
      refresh().catch(() => {})
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [documentId, detail, currentChunk, refresh])

  // Swap audio src when the active chunk changes, or when it finishes
  // generating (same chunk id, status flips pending -> ready via polling).
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !documentId || !currentChunk || currentChunk.status !== 'ready') return
    audio.src = chunkAudioUrl(documentId, currentChunk.sequenceIndex)
    audio.playbackRate = playbackRate
    if (isPlaying) audio.play().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, currentChunk?.id, currentChunk?.status, currentChunk?.audioUrl])

  const handleLoadedMetadata = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    setDuration(audio.duration)
    if (pendingSeekSecondsRef.current !== null) {
      audio.currentTime = pendingSeekSecondsRef.current
      pendingSeekSecondsRef.current = null
    }
  }, [])

  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    setCurrentTime(audio.currentTime)
    setWordIndex(findWordIndex(currentChunk, audio.currentTime * 1000))
  }, [currentChunk])

  const goToNextChunk = useCallback(() => {
    if (!detail) return
    setChunkIndex((idx) => Math.min(idx + 1, detail.chunks.length - 1))
    setWordIndex(null)
  }, [detail])

  const goToPrevChunk = useCallback(() => {
    setChunkIndex((idx) => Math.max(idx - 1, 0))
    setWordIndex(null)
  }, [])

  const handleEnded = useCallback(() => {
    if (!detail) return
    if (chunkIndex < detail.chunks.length - 1) {
      goToNextChunk()
    } else {
      setIsPlaying(false)
    }
  }, [detail, chunkIndex, goToNextChunk])

  const play = useCallback(() => {
    audioRef.current?.play().catch(() => {})
    setIsPlaying(true)
  }, [])

  const pause = useCallback(() => {
    audioRef.current?.pause()
    setIsPlaying(false)
  }, [])

  const togglePlay = useCallback(() => {
    if (isPlaying) pause()
    else play()
  }, [isPlaying, play, pause])

  /** Skip within the current chunk's audio, spilling into the next/previous chunk when the delta crosses a boundary. */
  const skip = useCallback(
    (deltaSeconds: number) => {
      const audio = audioRef.current
      if (!audio || !detail) return
      const target = audio.currentTime + deltaSeconds

      if (target < 0 && chunkIndex > 0) {
        const prevChunk = detail.chunks[chunkIndex - 1]
        if (prevChunk.status === 'ready' && prevChunk.durationSeconds !== null) {
          pendingSeekSecondsRef.current = Math.max(0, prevChunk.durationSeconds + target)
          setChunkIndex(chunkIndex - 1)
          setWordIndex(null)
          return
        }
      }

      if (audio.duration && target > audio.duration && chunkIndex < detail.chunks.length - 1) {
        const nextChunk = detail.chunks[chunkIndex + 1]
        if (nextChunk.status === 'ready') {
          pendingSeekSecondsRef.current = Math.max(0, target - audio.duration)
          setChunkIndex(chunkIndex + 1)
          setWordIndex(null)
          return
        }
      }

      audio.currentTime = Math.max(0, Math.min(audio.duration || Infinity, target))
    },
    [detail, chunkIndex],
  )

  const setPlaybackRate = useCallback((rate: number) => {
    setPlaybackRateState(rate)
    if (audioRef.current) audioRef.current.playbackRate = rate
  }, [])

  /**
   * Tap-to-jump: resolve a tapped word to its timestamp and seek there
   * (PRODUCT_PLAN.md §3). Words render across the whole document now, so a
   * tap can target any ready chunk, not just the currently active one.
   */
  const jumpToWord = useCallback(
    (targetChunkIndex: number, wordIndex: number) => {
      const audio = audioRef.current
      const chunk = detail?.chunks[targetChunkIndex]
      const word = chunk?.timingData?.words[wordIndex]
      if (!audio || !chunk || !word) return

      const seekSeconds = word.startMs / 1000
      if (targetChunkIndex === chunkIndex) {
        audio.currentTime = seekSeconds
        play()
      } else {
        // Audio src for the new chunk hasn't swapped in yet (that happens
        // in the effect below once `chunkIndex` updates) — just flag intent
        // to play and let it apply the pending seek once the new src loads,
        // instead of calling audio.play() on the still-stale src here.
        pendingSeekSecondsRef.current = seekSeconds
        setChunkIndex(targetChunkIndex)
        setIsPlaying(true)
      }
      setWordIndex(wordIndex)
    },
    [detail, chunkIndex, play],
  )

  // Periodically persist reading position.
  useEffect(() => {
    if (!documentId || !isPlaying) return
    const interval = setInterval(() => {
      const audio = audioRef.current
      if (!audio) return
      updatePosition(documentId, chunkIndex, audio.currentTime).catch(() => {})
    }, POSITION_SAVE_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [documentId, isPlaying, chunkIndex])

  // Save once more on pause/unmount so a quick pause-and-close isn't lost.
  useEffect(() => {
    return () => {
      const audio = audioRef.current
      if (documentId && audio) {
        updatePosition(documentId, chunkIndex, audio.currentTime).catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, chunkIndex])

  return {
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
    handlers: { handleLoadedMetadata, handleTimeUpdate, handleEnded },
    actions: { play, pause, togglePlay, skip, setPlaybackRate, jumpToWord, goToNextChunk, goToPrevChunk },
  }
}
