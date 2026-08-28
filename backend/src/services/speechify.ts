import { env } from '../config/env.js'
import type { WordTiming } from '../types/timing.js'
import type { SynthesizeResult, VoiceOption } from './ttsTypes.js'

/**
 * One entry of Speechify's speech marks tree. The top-level mark covers the
 * whole utterance and carries the per-word marks in `chunks`; each mark
 * gives both a time window and the character range it came from in the
 * submitted text.
 */
interface SpeechMark {
  type?: string
  start: number
  end: number
  start_time: number
  end_time: number
  value?: string
  chunks?: SpeechMark[]
}

interface SpeechResponse {
  audio_data: string
  audio_format?: string
  billable_characters_count?: number
  speech_marks?: SpeechMark
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

const SSML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

interface SsmlInput {
  ssml: string
  /**
   * For each character of the escaped *body* (the `<speak>...</speak>`
   * wrapper excluded), the character offset it came from in the source text.
   */
  sourceIndexAt: number[]
}

/**
 * Wraps the chunk in `<speak>` and escapes `& < >`.
 *
 * `input` is parsed as SSML, so an unescaped ampersand in ordinary prose is
 * a 400 rather than a spoken "and". Confirmed against a live response:
 * speech-mark `start`/`end` are offsets into the tag-stripped body text, not
 * the raw SSML string — a mark for the word starting right after "Hello "
 * came back as `start: 6`, not `start: 13` (6 plus the 7-character `<speak>`
 * prefix). So `sourceIndexAt` is built body-relative, with no padding for
 * the wrapper, and marks index into it directly. Escaping still shifts
 * offsets whenever it fires, which is why the mapping is built here rather
 * than reconstructed later — tap-to-jump resolves through the source
 * offsets (types/timing.ts), so they have to index the stored chunk text
 * exactly.
 */
function toSsml(text: string): SsmlInput {
  const sourceIndexAt: number[] = []
  let body = ''

  for (let i = 0; i < text.length; i++) {
    const piece = SSML_ESCAPES[text[i]] ?? text[i]
    body += piece
    for (let j = 0; j < piece.length; j++) sourceIndexAt.push(i)
  }

  return { ssml: `<speak>${body}</speak>`, sourceIndexAt }
}

/** Flattens the marks tree to its leaves — one per spoken word. */
function collectWordMarks(mark: SpeechMark | undefined): SpeechMark[] {
  if (!mark) return []
  if (!mark.chunks?.length) return [mark]
  return mark.chunks.flatMap(collectWordMarks)
}

interface TimeSpan {
  startMs: number
  endMs: number
}

/**
 * Spreads the silence around unmarked words evenly across them, so their
 * windows stay ordered and non-overlapping. findWordIndex() in
 * useReaderPlayback.ts scans linearly and depends on startMs never
 * decreasing.
 */
function fillUnmarkedWords(spans: (TimeSpan | null)[]): void {
  for (let i = 0; i < spans.length; i++) {
    if (spans[i]) continue

    let runEnd = i
    while (runEnd < spans.length && !spans[runEnd]) runEnd++

    const from = i > 0 ? spans[i - 1]!.endMs : 0
    const to = runEnd < spans.length ? Math.max(spans[runEnd]!.startMs, from) : from
    const step = (to - from) / (runEnd - i)

    for (let j = i; j < runEnd; j++) {
      spans[j] = {
        startMs: Math.round(from + step * (j - i)),
        endMs: Math.round(from + step * (j - i + 1)),
      }
    }
    i = runEnd - 1
  }
}

/**
 * Assigns each source word the time window of the speech mark covering it.
 *
 * Marks and source words are both in reading order, so one forward pass
 * matches them by character overlap. A word can be covered by several marks
 * (a hyphenated compound spoken as two), in which case the window widens to
 * span them all; a word covered by none (a lone dash, a symbol Speechify
 * doesn't voice) is filled in afterwards. Every source word comes out with a
 * window regardless: the reader renders the chunk *from* this array
 * (ChunkText.tsx), so a word missing here is a word missing from the page.
 */
function alignMarksToSource(
  text: string,
  marks: SpeechMark[],
  sourceIndexAt: number[],
  toMs: (time: number) => number,
): WordTiming[] {
  const sourceWords = tokenizeSourceWords(text)
  if (sourceWords.length === 0) return []

  const sourceOffsetOf = (bodyIndex: number): number =>
    sourceIndexAt[Math.max(0, Math.min(bodyIndex, sourceIndexAt.length - 1))]

  const spans: (TimeSpan | null)[] = new Array(sourceWords.length).fill(null)
  let cursor = 0

  for (const mark of marks) {
    const markStart = sourceOffsetOf(mark.start)
    const markEnd = Math.max(markStart + 1, sourceOffsetOf(mark.end - 1) + 1)

    while (cursor < sourceWords.length && sourceWords[cursor].charEnd <= markStart) cursor++
    if (cursor >= sourceWords.length) break
    if (sourceWords[cursor].charStart >= markEnd) continue

    const startMs = toMs(mark.start_time)
    const endMs = toMs(mark.end_time)
    const existing = spans[cursor]
    spans[cursor] = existing
      ? { startMs: Math.min(existing.startMs, startMs), endMs: Math.max(existing.endMs, endMs) }
      : { startMs, endMs }
  }

  fillUnmarkedWords(spans)

  return sourceWords.map((word, index) => ({
    word: word.text,
    charStart: word.charStart,
    charEnd: word.charEnd,
    startMs: spans[index]!.startMs,
    endMs: spans[index]!.endMs,
  }))
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
 * Deliberately not derived from the last word's end time: there is trailing
 * silence after the final word, and `durationSeconds` is what
 * useReaderPlayback.ts accumulates into `chunkOffsetsMs` to locate each
 * chunk inside the merged file. Under-reporting here would not just mistime
 * one chunk, it would shift every later chunk by the accumulated error.
 */
function mp3DurationSeconds(buffer: Buffer): number {
  let offset = 0

  if (buffer.length > 10 && buffer.toString('ascii', 0, 3) === 'ID3') {
    const tagSize =
      ((buffer[6] & 0x7f) << 21) |
      ((buffer[7] & 0x7f) << 14) |
      ((buffer[8] & 0x7f) << 7) |
      (buffer[9] & 0x7f)
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

/**
 * Speechify's docs contradict each other on the unit: the speech-marks guide
 * shows integer milliseconds, the /v1/audio/speech reference calls
 * `start_time` a double in seconds. Both describe a real response, so the
 * unit is settled against the audio itself — marks in seconds end around the
 * audio's own duration, marks in milliseconds end a thousandfold past it.
 */
function millisecondConverter(marks: SpeechMark[], durationSeconds: number): (time: number) => number {
  const lastEnd = marks.reduce((max, mark) => Math.max(max, mark.end_time), 0)
  const inSeconds = durationSeconds > 0 && lastEnd < durationSeconds * 3
  return inSeconds ? (time) => Math.round(time * 1000) : (time) => Math.round(time)
}

const SYNTHESIS_TIMEOUT_MS = 120_000

export async function synthesizeChunk(text: string, voiceId: string): Promise<SynthesizeResult> {
  const { ssml, sourceIndexAt } = toSsml(text)

  const response = await fetch(`${env.speechifyBaseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.speechifyApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: ssml,
      voice_id: voiceId,
      model: env.speechifyModel,
      audio_format: 'mp3',
    }),
    signal: AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Speechify TTS failed (${response.status}): ${body}`)
  }

  const data = (await response.json()) as SpeechResponse
  if (!data.audio_data) throw new Error('Speechify TTS returned no audio')

  const audioBuffer = Buffer.from(data.audio_data, 'base64')
  const marks = collectWordMarks(data.speech_marks)

  // Loud on purpose. Audio without timing still plays, so this would
  // otherwise surface as a document that reads aloud with no highlighting
  // and no error anywhere — and synced highlighting is the feature this app
  // exists for, so a chunk that cannot be highlighted is a failed chunk.
  if (marks.length === 0) {
    throw new Error('Speechify returned audio with no speech marks')
  }

  const framedDuration = mp3DurationSeconds(audioBuffer)
  const toMs = millisecondConverter(marks, framedDuration)
  const words = alignMarksToSource(text, marks, sourceIndexAt, toMs)
  const durationSeconds =
    framedDuration > 0 ? framedDuration : toMs(marks[marks.length - 1].end_time) / 1000

  return { audioBuffer, timing: { words }, durationSeconds }
}

interface SpeechifyVoice {
  id: string
  display_name?: string
  gender?: string
  locale?: string
}

function displayNameFor(voice: SpeechifyVoice): string {
  const name = voice.display_name?.trim() || voice.id
  const details = [voice.locale, voice.gender && voice.gender !== 'not_specified' ? voice.gender : undefined]
    .filter(Boolean)
    .join(', ')
  return details ? `${name} — ${details}` : name
}

// One page, no cursor loop: GET /voices syncs every returned voice into the
// `voices` table one row at a time over the Studio REST API, so pulling the
// whole catalog would cost hundreds of round trips per request for a picker
// nobody scrolls that far down.
const VOICE_PAGE_SIZE = 25

export async function listVoices(): Promise<VoiceOption[]> {
  const url = new URL(`${env.speechifyBaseUrl}/voices`)
  // Voice availability is per-model, so an unfiltered list would offer
  // voices the configured model rejects at synthesis time.
  url.searchParams.set('model', env.speechifyModel)
  url.searchParams.set('limit', String(VOICE_PAGE_SIZE))

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.speechifyApiKey}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    throw new Error(`Speechify voice listing failed (${response.status}): ${await response.text()}`)
  }

  const data = (await response.json()) as SpeechifyVoice[] | { voices?: SpeechifyVoice[] }
  const voices = Array.isArray(data) ? data : (data.voices ?? [])

  return voices
    .filter((voice) => typeof voice?.id === 'string' && voice.id.length > 0)
    .map((voice) => ({ providerVoiceId: voice.id, displayName: displayNameFor(voice) }))
}
