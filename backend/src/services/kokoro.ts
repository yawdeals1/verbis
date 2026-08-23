import { env } from '../config/env.js'
import type { WordTiming } from '../types/timing.js'
import type { SynthesizeResult, VoiceOption } from './ttsTypes.js'

/**
 * Kokoro spells these `start_time`/`end_time`. The project README documents
 * them as `start`/`end`, which is what this originally read — the mismatch
 * is silent rather than loud, because the missing field yields NaN through
 * Math.round and JSON serializes that to null, so chunks generate and play
 * with every highlight timestamp quietly empty. Both spellings are accepted
 * so a version that returns either keeps working.
 */
interface KokoroTimestamp {
  word: string
  start_time?: number
  end_time?: number
  start?: number
  end?: number
}

interface WordSpan {
  word: string
  startSeconds: number
  endSeconds: number
}

function finiteNumber(...candidates: (number | undefined)[]): number | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
  }
  return null
}

function toWordSpans(timestamps: KokoroTimestamp[]): WordSpan[] {
  const spans: WordSpan[] = []
  for (const stamp of timestamps) {
    const startSeconds = finiteNumber(stamp.start_time, stamp.start)
    const endSeconds = finiteNumber(stamp.end_time, stamp.end)
    if (startSeconds === null || endSeconds === null) continue
    spans.push({ word: stamp.word, startSeconds, endSeconds })
  }
  return spans
}

interface CaptionedSpeechResponse {
  audio: string
  timestamps: KokoroTimestamp[]
}

interface SourceWord {
  text: string
  charStart: number
  charEnd: number
}

function tokenizeSourceWords(text: string): SourceWord[] {
  const words: SourceWord[] = []
  const pattern = /\S+/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    words.push({ text: match[0], charStart: match.index, charEnd: match.index + match[0].length })
  }
  return words
}

/** Strips case and punctuation so a source token ("world,") matches Kokoro's spoken token ("world"). */
function comparable(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

const MATCH_LOOKAHEAD = 3

/**
 * Anchors Kokoro's per-word timings back onto the chunk's own character
 * offsets. Kokoro returns words with times but no character positions,
 * but tap-to-jump resolves a tapped word through `charStart`/`charEnd`
 * (types/timing.ts) — so the source text stays the authority for offsets and
 * Kokoro is only the authority for time.
 *
 * The two token streams are usually 1:1, but Kokoro phonemizes before
 * speaking, so a number or abbreviation can expand into several spoken
 * tokens ("42" -> "forty" "two"). A short lookahead resyncs after that kind
 * of drift; a word that still can't be matched borrows the current
 * position's timing rather than dropping out, which keeps `startMs`
 * non-decreasing — findWordIndex() in useReaderPlayback.ts scans linearly
 * and depends on that ordering.
 */
function alignTimingsToSource(text: string, spans: WordSpan[]): WordTiming[] {
  const sourceWords = tokenizeSourceWords(text)
  if (sourceWords.length === 0 || spans.length === 0) return []

  const words: WordTiming[] = []
  let cursor = 0

  for (const sourceWord of sourceWords) {
    const target = comparable(sourceWord.text)

    let matchIndex = -1
    for (let offset = 0; offset <= MATCH_LOOKAHEAD && cursor + offset < spans.length; offset++) {
      if (comparable(spans[cursor + offset].word) === target) {
        matchIndex = cursor + offset
        break
      }
    }

    const chosen = matchIndex === -1 ? Math.min(cursor, spans.length - 1) : matchIndex
    const span = spans[chosen]

    words.push({
      word: sourceWord.text,
      charStart: sourceWord.charStart,
      charEnd: sourceWord.charEnd,
      startMs: Math.round(span.startSeconds * 1000),
      endMs: Math.round(span.endSeconds * 1000),
    })

    cursor = chosen + 1
  }

  return words
}

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
const SAMPLE_RATES: Record<string, number[]> = {
  '1': [44100, 48000, 32000],
  '2': [22050, 24000, 16000],
  '2.5': [11025, 12000, 8000],
}

/**
 * True playback length, summed from the MP3's own frame headers.
 *
 * Deliberately not derived from the last word's end time: Kokoro can leave
 * trailing silence after the final word, and `durationSeconds` is what
 * useReaderPlayback.ts accumulates into `chunkOffsetsMs` to locate each
 * chunk inside the merged file. Under-reporting here would not just mistime
 * one chunk, it would shift every later chunk by the accumulated error.
 */
function mp3DurationSeconds(buffer: Buffer): number {
  let offset = 0

  if (buffer.length > 10 && buffer.toString('ascii', 0, 3) === 'ID3') {
    const tagSize =
      ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) | ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f)
    offset = 10 + tagSize
  }

  let duration = 0

  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff || (buffer[offset + 1] & 0xe0) !== 0xe0) {
      offset++
      continue
    }

    const versionBits = (buffer[offset + 1] >> 3) & 0x03
    const layerBits = (buffer[offset + 1] >> 1) & 0x03
    if (versionBits === 1 || layerBits !== 1) {
      offset++
      continue
    }

    const version = versionBits === 3 ? '1' : versionBits === 2 ? '2' : '2.5'
    const bitrateIndex = (buffer[offset + 2] >> 4) & 0x0f
    const sampleRateIndex = (buffer[offset + 2] >> 2) & 0x03
    if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
      offset++
      continue
    }

    const bitrate = (version === '1' ? BITRATES_V1_L3 : BITRATES_V2_L3)[bitrateIndex] * 1000
    const sampleRate = SAMPLE_RATES[version][sampleRateIndex]
    const padding = (buffer[offset + 2] >> 1) & 0x01
    const samplesPerFrame = version === '1' ? 1152 : 576

    const frameLength = Math.floor(((samplesPerFrame / 8) * bitrate) / sampleRate) + padding
    if (frameLength <= 0) {
      offset++
      continue
    }

    duration += samplesPerFrame / sampleRate
    offset += frameLength
  }

  return duration
}

const READY_POLL_INTERVAL_MS = 3_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Polls the voice listing until Kokoro serves it again.
 *
 * Uvicorn only finishes startup after the model is loaded and warmed (the
 * container logs "Warmup completed" before "Application startup complete"),
 * so a 200 here means the next synthesis request will reach a warmed
 * process — which a fixed sleep cannot promise. Measured recovery after a
 * kill is 45-60s, far longer than the 20s the retry used to wait, so every
 * retry landed on a container that was still loading and failed for that
 * reason rather than the original one.
 */
export async function waitUntilReady(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${env.kokoroBaseUrl}/v1/audio/voices`, {
        signal: AbortSignal.timeout(5_000),
      })
      if (response.ok) {
        await response.arrayBuffer()
        return true
      }
    } catch {
      // Connection refused while the container restarts, or the socket
      // closing mid-response. Both mean "not yet" — keep polling.
    }
    await sleep(READY_POLL_INTERVAL_MS)
  }
  return false
}

/**
 * Gives Kokoro's splitter something to break on, without touching the text
 * the timings are anchored to.
 *
 * smart_split only breaks at sentence boundaries until ABSOLUTE_MAX_TOKENS
 * forces it, and its fallback path yields an over-long clause unconditionally
 * — so text with no terminal punctuation (a table of contents, a heading
 * list, a bare bullet) is emitted as one huge forward pass no matter how the
 * token caps are set. That pass is what the host OOM killer lands on.
 * Terminating each line turns one such pass into several small ones.
 *
 * Only the synthesis request sees this. `alignTimingsToSource` still resolves
 * against the original text, and comparable() strips punctuation before
 * matching, so an added period attaches to a word that already exists rather
 * than becoming a token of its own — the character offsets tap-to-jump
 * depends on stay exactly as stored.
 */
function punctuateForSynthesis(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trimEnd()
      if (!trimmed) return line
      return /[.!?;:,]$/.test(trimmed) ? line : `${trimmed}.`
    })
    .join('\n')
}

export async function synthesizeChunk(text: string, voiceId: string): Promise<SynthesizeResult> {
  const response = await fetch(`${env.kokoroBaseUrl}/dev/captioned_speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'kokoro',
      input: punctuateForSynthesis(text),
      voice: voiceId,
      speed: 1.0,
      response_format: 'mp3',
      stream: false,
    }),
    // CPU synthesis runs at roughly playback speed, so one chunk can take as
    // long as the audio it produces — well past any default fetch timeout.
    signal: AbortSignal.timeout(env.kokoroTimeoutMs),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Kokoro TTS failed (${response.status}): ${body}`)
  }

  const data = (await response.json()) as CaptionedSpeechResponse
  if (!data.audio) throw new Error('Kokoro TTS returned no audio')

  const audioBuffer = Buffer.from(data.audio, 'base64')
  const spans = toWordSpans(data.timestamps ?? [])

  // Loud on purpose. Audio without timing still plays, so this would
  // otherwise surface as a document that reads aloud with no highlighting
  // and no error anywhere — and synced highlighting is the feature this app
  // exists for, so a chunk that cannot be highlighted is a failed chunk.
  if (spans.length === 0) {
    throw new Error(
      `Kokoro returned ${data.timestamps?.length ?? 0} timestamps with no usable start/end times`,
    )
  }

  const words = alignTimingsToSource(text, spans)

  const framedDuration = mp3DurationSeconds(audioBuffer)
  const durationSeconds = framedDuration > 0 ? framedDuration : spans[spans.length - 1].endSeconds

  return { audioBuffer, timing: { words }, durationSeconds }
}

const LANGUAGE_LABELS: Record<string, string> = {
  a: 'American English',
  b: 'British English',
  e: 'Spanish',
  f: 'French',
  h: 'Hindi',
  i: 'Italian',
  j: 'Japanese',
  p: 'Portuguese',
  z: 'Chinese',
}

/** Turns a Kokoro voice code ("af_bella") into something readable ("Bella — American English, female"). */
function displayNameFor(voiceCode: string): string {
  const match = /^([a-z])([fm])_(.+)$/.exec(voiceCode)
  if (!match) return voiceCode

  const [, languageKey, genderKey, name] = match
  const language = LANGUAGE_LABELS[languageKey]
  const gender = genderKey === 'f' ? 'female' : 'male'
  const capitalized = name.charAt(0).toUpperCase() + name.slice(1)

  return language ? `${capitalized} — ${language}, ${gender}` : `${capitalized} (${gender})`
}

const FALLBACK_VOICES: VoiceOption[] = ['af_heart', 'af_bella', 'am_michael', 'bf_emma'].map((code) => ({
  providerVoiceId: code,
  displayName: displayNameFor(code),
}))

export async function listVoices(): Promise<VoiceOption[]> {
  const response = await fetch(`${env.kokoroBaseUrl}/v1/audio/voices`, {
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    throw new Error(`Kokoro voice listing failed (${response.status})`)
  }

  const data = (await response.json()) as { voices?: unknown }
  const codes = Array.isArray(data.voices)
    ? data.voices
        .map((voice) => {
          if (typeof voice === 'string') return voice
          const record = voice as { id?: string; name?: string }
          return record?.id ?? record?.name
        })
        .filter((code): code is string => typeof code === 'string' && code.length > 0)
    : []

  if (codes.length === 0) return FALLBACK_VOICES

  return codes.map((code) => ({ providerVoiceId: code, displayName: displayNameFor(code) }))
}
