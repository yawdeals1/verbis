import type { WordTiming } from '../types/timing.js'

/**
 * Word timing for TTS backends that return audio without speech marks
 * (OpenRouter's speech endpoint is audio-only).
 *
 * Spreading words evenly over the whole clip drifts badly by the end of a
 * paragraph, because the voice pauses at punctuation and speeds through
 * short words. So the audio itself is read for the two things it reliably
 * reveals: where speech starts and stops, and where the voice goes silent
 * mid-chunk. Those silences are matched to punctuation in the text and used
 * as fixed anchors, and words are only interpolated *between* anchors — any
 * drift resets at every sentence or clause break instead of accumulating.
 */

const FRAME_MS = 10
// TTS output has a near-digital noise floor, so anything this far below the
// loudest frame is silence rather than a quiet consonant.
const SILENCE_RATIO = 0.01
const MIN_PAUSE_MS = 100
// Measured on HeyGen at the threshold above: 0.44–0.70s after every
// sentence end, 0.13–0.29s after a comma.
const LONG_PAUSE_MS = 360
// How far a detected pause may sit from where the proportional model
// expects a punctuation break and still be treated as that break.
const MATCH_TOLERANCE_MS = 2000

const CLAUSE_END = /[,;:—–-]["'”’)\]]*$/
const SENTENCE_END = /[.!?…]["'”’)\]]*$/
// Extra weight, in letter-equivalents, for the pause an unanchored
// punctuation mark usually gets.
const CLAUSE_PAUSE_WEIGHT = 3
const SENTENCE_PAUSE_WEIGHT = 6

interface SourceWord {
  text: string
  charStart: number
  charEnd: number
}

interface Span {
  start: number
  end: number
}

function tokenize(text: string): SourceWord[] {
  const words: SourceWord[] = []
  const pattern = /\S+/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    words.push({ text: match[0], charStart: match.index, charEnd: match.index + match[0].length })
  }
  return words
}

// Spoken symbols, in letters: "$" is "dollars", "%" is "percent".
const SYMBOL_WEIGHTS: Record<string, number> = { $: 7, '%': 7, '&': 3, '£': 6, '€': 5 }

/**
 * Spoken length in letter-equivalents. A digit weighs about four letters
 * ("7:45" is "seven forty-five", "2019" is "twenty nineteen"), and a decimal
 * point is the word "point" — weighting digits like letters made every
 * number-heavy sentence run a second or more ahead of the voice.
 */
function spokenWeight(word: string): number {
  const letters = word.match(/\p{L}/gu)?.length ?? 0
  const digits = word.match(/\p{N}/gu)?.length ?? 0
  const decimalPoints = word.match(/\p{N}\.\p{N}/gu)?.length ?? 0
  const symbols = [...word].reduce((sum, char) => sum + (SYMBOL_WEIGHTS[char] ?? 0), 0)
  return Math.max(1, letters + digits * 4 + decimalPoints * 5 + symbols)
}

// Periods that don't end a sentence, so the voice doesn't pause after them.
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'vs', 'etc', 'eg', 'ie', 'vol', 'fig', 'approx',
])

function isSentenceEnd(word: string): boolean {
  if (!SENTENCE_END.test(word)) return false
  if (!/\.["'”’)\]]*$/.test(word)) return true
  const bare = word.toLowerCase().replace(/[^\p{L}]/gu, '')
  return !ABBREVIATIONS.has(bare) && !/^\p{L}$/u.test(bare)
}

function pauseWeightAfter(word: string): number {
  if (isSentenceEnd(word)) return SENTENCE_PAUSE_WEIGHT
  if (CLAUSE_END.test(word)) return CLAUSE_PAUSE_WEIGHT
  return 0
}

function frameLevels(pcm: Buffer, sampleRate: number, channels: number): number[] {
  const samplesPerFrame = Math.max(1, Math.round((sampleRate * channels * FRAME_MS) / 1000))
  const totalSamples = Math.floor(pcm.length / 2)
  const levels: number[] = []
  for (let first = 0; first < totalSamples; first += samplesPerFrame) {
    const last = Math.min(first + samplesPerFrame, totalSamples)
    let sumSquares = 0
    for (let i = first; i < last; i++) {
      const sample = pcm.readInt16LE(i * 2)
      sumSquares += sample * sample
    }
    levels.push(Math.sqrt(sumSquares / (last - first)))
  }
  return levels
}

interface SpeechLayout {
  speech: Span
  pauses: Span[]
}

function analyzeSpeech(levels: number[], totalMs: number): SpeechLayout {
  const peak = levels.reduce((max, level) => Math.max(max, level), 0)
  const threshold = peak * SILENCE_RATIO
  const voiced = levels.map((level) => level > threshold)

  const firstVoiced = voiced.indexOf(true)
  const lastVoiced = voiced.lastIndexOf(true)
  if (firstVoiced === -1) return { speech: { start: 0, end: totalMs }, pauses: [] }

  const pauses: Span[] = []
  let runStart = -1
  for (let i = firstVoiced; i <= lastVoiced; i++) {
    if (!voiced[i]) {
      if (runStart === -1) runStart = i
      continue
    }
    if (runStart !== -1 && (i - runStart) * FRAME_MS >= MIN_PAUSE_MS) {
      pauses.push({ start: runStart * FRAME_MS, end: i * FRAME_MS })
    }
    runStart = -1
  }

  return {
    speech: { start: firstVoiced * FRAME_MS, end: Math.min(totalMs, (lastVoiced + 1) * FRAME_MS) },
    pauses,
  }
}

/**
 * Lays words out proportionally to their spoken weight over `span`, with
 * punctuation pauses folded in. `anchoredAfter` marks word indices whose
 * following pause is already an explicit gap, so it isn't counted twice.
 */
function distribute(
  words: SourceWord[],
  from: number,
  to: number,
  span: Span,
  anchoredAfter: Set<number>,
): Span[] {
  const units: { word: number; pause: number }[] = []
  let total = 0
  for (let i = from; i < to; i++) {
    const word = spokenWeight(words[i].text)
    const pause = i < to - 1 && !anchoredAfter.has(i) ? pauseWeightAfter(words[i].text) : 0
    units.push({ word, pause })
    total += word + pause
  }

  const msPerUnit = total > 0 ? (span.end - span.start) / total : 0
  const spans: Span[] = []
  let cursor = span.start
  for (const unit of units) {
    const start = cursor
    const end = start + unit.word * msPerUnit
    spans.push({ start, end })
    cursor = end + unit.pause * msPerUnit
  }
  return spans
}

interface Anchor {
  /** Index of the last word before the pause. */
  afterWord: number
  pause: Span
}

/**
 * Monotonic best matching between detected pauses and punctuation breaks,
 * scored by how close each pause sits to where its break was predicted.
 * Greedy nearest-match goes wrong when one pause is skipped (a comma read
 * without a breath) and every later pause shifts onto the wrong break; an
 * alignment over the whole sequence doesn't.
 */
function matchPausesToBreaks(pauses: Span[], breaks: { afterWord: number; predictedMs: number }[]): Anchor[] {
  const p = pauses.length
  const b = breaks.length
  const score: number[][] = Array.from({ length: p + 1 }, () => new Array(b + 1).fill(0))

  const matchScore = (i: number, j: number): number => {
    const mid = (pauses[i].start + pauses[i].end) / 2
    const diff = Math.abs(mid - breaks[j].predictedMs)
    return diff < MATCH_TOLERANCE_MS ? 1 - diff / MATCH_TOLERANCE_MS : -Infinity
  }

  for (let i = 1; i <= p; i++) {
    for (let j = 1; j <= b; j++) {
      score[i][j] = Math.max(score[i - 1][j], score[i][j - 1], score[i - 1][j - 1] + matchScore(i - 1, j - 1))
    }
  }

  const anchors: Anchor[] = []
  let i = p
  let j = b
  while (i > 0 && j > 0) {
    if (score[i][j] === score[i - 1][j]) i--
    else if (score[i][j] === score[i][j - 1]) j--
    else {
      anchors.push({ afterWord: breaks[j - 1].afterWord, pause: pauses[i - 1] })
      i--
      j--
    }
  }
  return anchors.reverse()
}

interface Segment {
  from: number
  to: number
  span: Span
}

function segmentsBetween(anchors: Anchor[], wordCount: number, speech: Span): Segment[] {
  const segments: Segment[] = []
  let from = 0
  let start = speech.start
  for (const anchor of anchors) {
    segments.push({ from, to: anchor.afterWord + 1, span: { start, end: anchor.pause.start } })
    from = anchor.afterWord + 1
    start = anchor.pause.end
  }
  segments.push({ from, to: wordCount, span: { start, end: speech.end } })
  return segments
}

function anchorSegments(
  words: SourceWord[],
  segments: Segment[],
  pauses: Span[],
  anchoredAfter: Set<number>,
  options: { isBreak: (word: string) => boolean; minPauseMs: number },
): Anchor[] {
  return segments.flatMap((segment) => {
    const predicted = distribute(words, segment.from, segment.to, segment.span, anchoredAfter)
    const breaks: { afterWord: number; predictedMs: number }[] = []
    for (let i = segment.from; i < segment.to - 1; i++) {
      if (!options.isBreak(words[i].text)) continue
      const local = i - segment.from
      breaks.push({ afterWord: i, predictedMs: (predicted[local].end + predicted[local + 1].start) / 2 })
    }
    const candidates = pauses.filter(
      (pause) =>
        pause.end - pause.start >= options.minPauseMs &&
        pause.start >= segment.span.start &&
        pause.end <= segment.span.end,
    )
    return matchPausesToBreaks(candidates, breaks)
  })
}

export function estimateWordTimings(
  text: string,
  pcm: Buffer,
  sampleRate: number,
  channels: number,
): WordTiming[] {
  const words = tokenize(text)
  if (words.length === 0) return []

  const totalMs = (pcm.length / 2 / channels / sampleRate) * 1000
  const { speech, pauses } = analyzeSpeech(frameLevels(pcm, sampleRate, channels), totalMs)

  // Two passes, coarse then fine. Matched in one pass against a prediction
  // made over the whole chunk, a pace change partway through drifts the
  // prediction far enough that pauses slide onto the neighbouring comma, and
  // every word after it lands a second or two early (measured against a
  // 65s HeyGen chunk). Sentence ends are the reliable signal — they get the
  // long pauses — so they're anchored first, and commas are then matched
  // against a prediction made only within their own sentence.
  const sentenceAnchors = anchorSegments(words, [{ from: 0, to: words.length, span: speech }], pauses, new Set(), {
    isBreak: isSentenceEnd,
    minPauseMs: LONG_PAUSE_MS,
  })
  const anchoredAfterSentences = new Set(sentenceAnchors.map((anchor) => anchor.afterWord))
  const clauseAnchors = anchorSegments(
    words,
    segmentsBetween(sentenceAnchors, words.length, speech),
    pauses.filter((pause) => !sentenceAnchors.some((anchor) => anchor.pause === pause)),
    anchoredAfterSentences,
    { isBreak: (word) => pauseWeightAfter(word) > 0, minPauseMs: MIN_PAUSE_MS },
  )

  const anchors = [...sentenceAnchors, ...clauseAnchors].sort((a, b) => a.afterWord - b.afterWord)
  const anchoredAfter = new Set(anchors.map((anchor) => anchor.afterWord))

  const spans = segmentsBetween(anchors, words.length, speech).flatMap((segment) =>
    distribute(words, segment.from, segment.to, segment.span, anchoredAfter),
  )

  return words.map((word, index) => ({
    word: word.text,
    charStart: word.charStart,
    charEnd: word.charEnd,
    startMs: Math.round(spans[index].start),
    endMs: Math.round(spans[index].end),
  }))
}
