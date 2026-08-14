import { env } from '../config/env.js'
import type { TimingData, WordTiming } from '../types/timing.js'

const API_BASE = 'https://api.elevenlabs.io/v1'

interface AlignmentResponse {
  audio_base64: string
  alignment: {
    characters: string[]
    character_start_times_seconds: number[]
    character_end_times_seconds: number[]
  }
}

/**
 * Groups per-character alignment into per-word timing. ElevenLabs returns
 * character-level timestamps, not pre-grouped words (PRODUCT_PLAN.md §2) —
 * words are split on whitespace while tracking character offsets so the
 * frontend can map a tapped word straight to a playback timestamp.
 */
function deriveWordTimings(alignment: AlignmentResponse['alignment']): WordTiming[] {
  const { characters, character_start_times_seconds, character_end_times_seconds } = alignment
  const words: WordTiming[] = []

  let bufferStart = -1
  let bufferChars = ''

  const flush = (endIndex: number) => {
    if (!bufferChars.trim()) {
      bufferChars = ''
      bufferStart = -1
      return
    }
    words.push({
      word: bufferChars,
      charStart: bufferStart,
      charEnd: endIndex,
      startMs: Math.round(character_start_times_seconds[bufferStart] * 1000),
      endMs: Math.round(character_end_times_seconds[endIndex - 1] * 1000),
    })
    bufferChars = ''
    bufferStart = -1
  }

  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i]
    if (/\s/.test(ch)) {
      flush(i)
    } else {
      if (bufferStart === -1) bufferStart = i
      bufferChars += ch
    }
  }
  flush(characters.length)

  return words
}

export interface SynthesizeResult {
  audioBuffer: Buffer
  timing: TimingData
  durationSeconds: number
}

export async function synthesizeChunk(text: string, voiceId: string): Promise<SynthesizeResult> {
  const response = await fetch(`${API_BASE}/text-to-speech/${voiceId}/with-timestamps`, {
    method: 'POST',
    headers: {
      'xi-api-key': env.elevenLabsApiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`ElevenLabs TTS failed (${response.status}): ${body}`)
  }

  const data = (await response.json()) as AlignmentResponse
  const audioBuffer = Buffer.from(data.audio_base64, 'base64')
  const words = deriveWordTimings(data.alignment)
  const durationSeconds =
    data.alignment.character_end_times_seconds[data.alignment.character_end_times_seconds.length - 1] ?? 0

  return { audioBuffer, timing: { words }, durationSeconds }
}

export interface VoiceOption {
  providerVoiceId: string
  displayName: string
}

const FALLBACK_VOICES: VoiceOption[] = [
  { providerVoiceId: '21m00Tcm4TlvDq8ikWAM', displayName: 'Rachel' },
  { providerVoiceId: 'pNInz6obpgDQGcFmaJgB', displayName: 'Adam' },
  { providerVoiceId: 'EXAVITQu4vr4xnSDxMaL', displayName: 'Bella' },
]

/** Lists available ElevenLabs voices; falls back to well-known default voice IDs if the call fails. */
export async function listVoices(): Promise<VoiceOption[]> {
  try {
    const response = await fetch(`${API_BASE}/voices`, {
      headers: { 'xi-api-key': env.elevenLabsApiKey },
    })
    if (!response.ok) return FALLBACK_VOICES

    const data = (await response.json()) as { voices: { voice_id: string; name: string }[] }
    if (!data.voices?.length) return FALLBACK_VOICES

    return data.voices.slice(0, 5).map((v) => ({ providerVoiceId: v.voice_id, displayName: v.name }))
  } catch {
    return FALLBACK_VOICES
  }
}
