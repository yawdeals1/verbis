import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { chunkAudioUrl, getDocument, mergeDocumentAudio, mergedAudioUrl, updatePosition } from '../api/client'
import type { ChunkStatus, ChunkSummary, DocumentDetail } from '../api/types'

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

/**
 * How many leading chunks generation has resolved one way or another (ready
 * or permanently failed). Generation runs strictly in sequence
 * (services/generation.ts), so a chunk is never ready while an earlier one
 * is still pending — the first pending chunk is the frontier, and it mirrors
 * the same count the backend computes in documents.ts's POST /merge.
 */
function resolvedChunkCount(chunks: { status: ChunkStatus }[]): number {
  const pendingIndex = chunks.findIndex((c) => c.status === 'pending')
  return pendingIndex === -1 ? chunks.length : pendingIndex
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
  // Continuous playback across one merged audio file instead of per-chunk
  // <audio> src swaps — eliminates the brief reload/pause at chunk
  // boundaries ("merge all sections", see mergeAudio below).
  const [mergedMode, setMergedMode] = useState(false)
  const [isMerging, setIsMerging] = useState(false)
  const [mergeError, setMergeError] = useState<string | null>(null)
  // How many leading chunks the currently-loaded merged file covers, and
  // whether that's the whole document or generation is still filling in more
  // behind it — both come straight from the last POST /merge response.
  const [mergedChunkCount, setMergedChunkCount] = useState(0)
  const [mergedComplete, setMergedComplete] = useState(false)
  // True once playback has run into the end of what's currently merged but
  // the document isn't finished yet — the growth effect below watches this
  // and re-merges/resumes the instant more chunks resolve, instead of the
  // player just stopping there.
  const [isBufferingMore, setIsBufferingMore] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const hasAppliedResumeRef = useRef(false)
  const pendingSeekSecondsRef = useRef<number | null>(null)

  /**
   * Next chunk in `direction` that has audio, skipping ones whose synthesis
   * failed. Without this a single failed chunk is a dead stop: nothing sets an
   * audio src for it, so no `ended` fires and playback never resumes.
   */
  const playableIndexFrom = useCallback(
    (chunks: { status: ChunkStatus }[], from: number, direction: 1 | -1) => {
      for (let i = from; i >= 0 && i < chunks.length; i += direction) {
        if (chunks[i].status !== 'error') return i
      }
      return null
    },
    [],
  )

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
          const savedIndex = data.document.lastPosition.chunkSequenceIndex
          // The saved chunk may have since been marked `error` (or already was) —
          // landing on it directly would leave playback stalled with no src ever
          // set, so fall forward to the next playable chunk same as opening cold.
          const resumeIndex =
            data.chunks[savedIndex]?.status === 'error' ? playableIndexFrom(data.chunks, savedIndex, 1) : savedIndex
          if (resumeIndex !== null) {
            if (resumeIndex === savedIndex) pendingSeekSecondsRef.current = data.document.lastPosition.timeSeconds
            setChunkIndex(resumeIndex)
          }
          return
        }
        // Front matter is the most likely chunk to have failed synthesis, so
        // opening a document at chunk 0 can land on one that will never play.
        const opening = playableIndexFrom(data.chunks, 0, 1)
        if (opening !== null) setChunkIndex(opening)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load document')
      })

    return () => {
      cancelled = true
    }
  }, [documentId])

  const currentChunk = detail?.chunks[chunkIndex]

  // At least one section has to be ready to merge anything — unlike before,
  // this no longer waits for the whole document (see resolvedChunkCount).
  const canMerge = Boolean(
    detail && detail.chunks.slice(0, resolvedChunkCount(detail.chunks)).some((c) => c.status === 'ready'),
  )

  // Cumulative start offset (ms) of each chunk within the merged file — chunk
  // i's audio begins right after the sum of every earlier chunk's duration,
  // since the backend concatenates them in sequenceIndex order untouched.
  const chunkOffsetsMs = useMemo(() => {
    if (!detail) return []
    const offsets: number[] = []
    let acc = 0
    for (const chunk of detail.chunks) {
      offsets.push(acc)
      acc += (chunk.durationSeconds ?? 0) * 1000
    }
    return offsets
  }, [detail])

  /** Which chunk a position in the merged timeline falls into. */
  const chunkIndexForGlobalMs = useCallback(
    (globalMs: number): number => {
      let idx = 0
      for (let i = 0; i < chunkOffsetsMs.length; i++) {
        if (chunkOffsetsMs[i] <= globalMs) idx = i
        else break
      }
      return idx
    },
    [chunkOffsetsMs],
  )

  // Poll while the current (or document) generation is still in progress —
  // also while merged playback has run dry waiting for more sections, since
  // that can happen well after `currentChunk` (the last already-merged one)
  // stopped being pending.
  useEffect(() => {
    if (!documentId || !detail) return
    const stillGenerating =
      detail.document.status === 'processing' ||
      (currentChunk && currentChunk.status === 'pending') ||
      isBufferingMore
    if (!stillGenerating) return

    const interval = setInterval(() => {
      refresh().catch(() => {})
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [documentId, detail, currentChunk, refresh, isBufferingMore])

  // Swap audio src when the active chunk changes, or when it finishes
  // generating (same chunk id, status flips pending -> ready via polling).
  // Skipped in merged mode — one continuous file is already loaded there,
  // and chunkIndex changes purely reflect playback position, not a src swap.
  useEffect(() => {
    if (mergedMode) return
    const audio = audioRef.current
    if (!audio || !documentId || !currentChunk || currentChunk.status !== 'ready') return
    audio.src = chunkAudioUrl(documentId, currentChunk.sequenceIndex)
    audio.playbackRate = playbackRate
    if (isPlaying) audio.play().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergedMode, documentId, currentChunk?.id, currentChunk?.status, currentChunk?.audioUrl])

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
    if (!audio || !detail) return
    setCurrentTime(audio.currentTime)

    if (mergedMode) {
      const globalMs = audio.currentTime * 1000
      const idx = chunkIndexForGlobalMs(globalMs)
      setChunkIndex(idx)
      setWordIndex(findWordIndex(detail.chunks[idx], globalMs - chunkOffsetsMs[idx]))
      return
    }

    setWordIndex(findWordIndex(currentChunk, audio.currentTime * 1000))
  }, [detail, mergedMode, chunkIndexForGlobalMs, chunkOffsetsMs, currentChunk])

  /** In merged mode there's no src swap to carry the seek — jump the shared audio element to the target chunk's start directly, or handleTimeUpdate's next tick would just snap chunkIndex back to wherever the audio actually is. */
  const goToChunk = useCallback(
    (targetIndex: number) => {
      if (!detail) return
      const clamped = Math.max(0, Math.min(targetIndex, detail.chunks.length - 1))
      if (mergedMode) {
        const audio = audioRef.current
        if (audio) audio.currentTime = (chunkOffsetsMs[clamped] ?? 0) / 1000
      }
      setChunkIndex(clamped)
      setWordIndex(null)
    },
    [detail, mergedMode, chunkOffsetsMs],
  )

  // Skip over `error` chunks same as handleEnded does — jumping straight to
  // chunkIndex +/- 1 could land on one, and since nothing sets an audio src
  // for a non-`ready` chunk, that's a silent dead stop rather than a skip.
  const goToNextChunk = useCallback(() => {
    if (!detail) return
    const next = playableIndexFrom(detail.chunks, chunkIndex + 1, 1)
    if (next !== null) goToChunk(next)
  }, [detail, chunkIndex, goToChunk, playableIndexFrom])

  const goToPrevChunk = useCallback(() => {
    if (!detail) return
    const prev = playableIndexFrom(detail.chunks, chunkIndex - 1, -1)
    if (prev !== null) goToChunk(prev)
  }, [detail, chunkIndex, goToChunk, playableIndexFrom])

  const handleEnded = useCallback(() => {
    if (!detail) return
    if (mergedMode) {
      // Reached the end of what's merged so far. If the document isn't
      // fully generated yet, this isn't really the end — flag it and let
      // the growth effect above resume playback once more sections resolve,
      // instead of just stopping.
      if (!mergedComplete) {
        setIsBufferingMore(true)
        return
      }
      setIsPlaying(false)
      return
    }
    const next = playableIndexFrom(detail.chunks, chunkIndex + 1, 1)
    if (next === null) {
      setIsPlaying(false)
      return
    }
    goToChunk(next)
  }, [detail, mergedMode, mergedComplete, chunkIndex, goToChunk, playableIndexFrom])

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

  /** Skip within the current chunk's audio, spilling into the next/previous chunk when the delta crosses a boundary. In merged mode there are no boundaries to spill across — it's one file. */
  const skip = useCallback(
    (deltaSeconds: number) => {
      const audio = audioRef.current
      if (!audio || !detail) return
      const target = audio.currentTime + deltaSeconds

      if (mergedMode) {
        audio.currentTime = Math.max(0, Math.min(audio.duration || Infinity, target))
        return
      }

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
    [detail, mergedMode, chunkIndex],
  )

  const setPlaybackRate = useCallback((rate: number) => {
    setPlaybackRateState(rate)
    if (audioRef.current) audioRef.current.playbackRate = rate
  }, [])

  /**
   * Tap-to-jump: resolve a tapped word to its timestamp and seek there
   * (PRODUCT_PLAN.md §3). Words render across the whole document now, so a
   * tap can target any ready chunk, not just the currently active one. In
   * merged mode every chunk lives in the same audio file, so this is just a
   * seek — no src swap or pending-seek handoff needed.
   */
  const jumpToWord = useCallback(
    (targetChunkIndex: number, wordIndex: number) => {
      const audio = audioRef.current
      const chunk = detail?.chunks[targetChunkIndex]
      const word = chunk?.timingData?.words[wordIndex]
      if (!audio || !chunk || !word) return

      if (mergedMode) {
        audio.currentTime = (chunkOffsetsMs[targetChunkIndex] + word.startMs) / 1000
        play()
        setChunkIndex(targetChunkIndex)
        setWordIndex(wordIndex)
        return
      }

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
    [detail, mergedMode, chunkOffsetsMs, chunkIndex, play],
  )

  /**
   * Concatenates every currently-resolved chunk into one audio file
   * server-side and switches (or stays) on it, preserving position and
   * play/pause state across the swap.
   *
   * Doubles as the "extend" call once already in merged mode: the growth
   * effect below calls this again after more chunks resolve, and since the
   * merged file lives at the same URL each time, `audio.load()` is required
   * to force a refetch — reassigning an unchanged `.src` string is a no-op.
   */
  const mergeAudio = useCallback(async () => {
    if (!documentId || isMerging) return
    setIsMerging(true)
    setMergeError(null)
    try {
      const result = await mergeDocumentAudio(documentId)
      const audio = audioRef.current
      const globalSeconds = mergedMode
        ? (audio?.currentTime ?? 0)
        : (chunkOffsetsMs[chunkIndex] ?? 0) / 1000 + (audio?.currentTime ?? 0)
      pendingSeekSecondsRef.current = globalSeconds
      setMergedMode(true)
      setMergedChunkCount(result.chunkCount)
      setMergedComplete(result.complete)
      if (audio) {
        audio.src = mergedAudioUrl(documentId)
        audio.load()
        audio.playbackRate = playbackRate
        if (isPlaying) audio.play().catch(() => {})
      }
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : 'Failed to merge sections')
    } finally {
      setIsMerging(false)
    }
  }, [documentId, isMerging, mergedMode, chunkOffsetsMs, chunkIndex, playbackRate, isPlaying])

  /**
   * Once playback has run into the end of what's merged so far
   * (isBufferingMore, set by handleEnded below) and more chunks have since
   * resolved, pick the merge back up automatically — the listener never has
   * to notice or re-click anything, generation just catches up underneath
   * them.
   */
  useEffect(() => {
    if (!isBufferingMore || !detail || isMerging) return
    if (resolvedChunkCount(detail.chunks) > mergedChunkCount) {
      setIsBufferingMore(false)
      mergeAudio()
    }
  }, [isBufferingMore, detail, mergedChunkCount, isMerging, mergeAudio])

  /** Chunk-local (sequenceIndex, timeSeconds) for the resume-position API, regardless of which mode is currently playing — so resuming later always lands back in normal per-chunk mode at the right spot. */
  const getLocalPosition = useCallback(
    (audio: HTMLAudioElement): { chunkSequenceIndex: number; timeSeconds: number } => {
      if (mergedMode) {
        const globalMs = audio.currentTime * 1000
        const idx = chunkIndexForGlobalMs(globalMs)
        return { chunkSequenceIndex: idx, timeSeconds: (globalMs - chunkOffsetsMs[idx]) / 1000 }
      }
      return { chunkSequenceIndex: chunkIndex, timeSeconds: audio.currentTime }
    },
    [mergedMode, chunkIndexForGlobalMs, chunkOffsetsMs, chunkIndex],
  )

  // Periodically persist reading position.
  useEffect(() => {
    if (!documentId || !isPlaying) return
    const interval = setInterval(() => {
      const audio = audioRef.current
      if (!audio) return
      const { chunkSequenceIndex, timeSeconds } = getLocalPosition(audio)
      updatePosition(documentId, chunkSequenceIndex, timeSeconds).catch(() => {})
    }, POSITION_SAVE_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [documentId, isPlaying, getLocalPosition])

  // Save once more on pause/unmount so a quick pause-and-close isn't lost.
  useEffect(() => {
    return () => {
      const audio = audioRef.current
      if (documentId && audio) {
        const { chunkSequenceIndex, timeSeconds } = getLocalPosition(audio)
        updatePosition(documentId, chunkSequenceIndex, timeSeconds).catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, getLocalPosition])

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
    mergedMode,
    isMerging,
    mergeError,
    canMerge,
    mergedComplete,
    isBufferingMore,
    handlers: { handleLoadedMetadata, handleTimeUpdate, handleEnded },
    actions: { play, pause, togglePlay, skip, setPlaybackRate, jumpToWord, goToNextChunk, goToPrevChunk, mergeAudio },
  }
}
