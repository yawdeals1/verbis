import { spawn } from 'node:child_process'
import { env } from '../config/env.js'
import { mp3DurationSeconds } from '../lib/mp3.js'
import { estimateWordTimings } from './estimatedTiming.js'
import type { SynthesizeResult, VoiceOption } from './ttsTypes.js'

const API_BASE = 'https://openrouter.ai/api/v1'
const SYNTHESIS_TIMEOUT_MS = 120_000

interface PcmFormat {
  sampleRate: number
  channels: number
}

/**
 * HeyGen through OpenRouter only accepts `response_format: "pcm"` (an `mp3`
 * request is a 400), and reports the format only in the content type:
 * `audio/pcm;rate=44100;channels=1`. Samples are signed 16-bit little-endian.
 */
function parsePcmFormat(contentType: string | null): PcmFormat {
  const rate = contentType?.match(/rate=(\d+)/)?.[1]
  const channels = contentType?.match(/channels=(\d+)/)?.[1]
  if (!contentType?.startsWith('audio/pcm') || !rate) {
    throw new Error(`OpenRouter TTS returned unexpected audio format: ${contentType}`)
  }
  return { sampleRate: Number(rate), channels: Number(channels ?? 1) }
}

/**
 * Storage, the audio route and the merged-playback concat all assume MP3.
 * The Xing header and ID3 tag are suppressed because chunks get
 * byte-concatenated into one file (POST /documents/:id/merge), where a
 * mid-stream Xing frame would make players misreport the merged length.
 */
function encodeMp3(pcm: Buffer, format: PcmFormat): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-loglevel', 'error',
      '-f', 's16le',
      '-ar', String(format.sampleRate),
      '-ac', String(format.channels),
      '-i', 'pipe:0',
      '-codec:a', 'libmp3lame',
      '-b:a', '128k',
      '-write_xing', '0',
      '-id3v2_version', '0',
      '-map_metadata', '-1',
      '-f', 'mp3',
      'pipe:1',
    ])

    const output: Buffer[] = []
    const errors: Buffer[] = []
    ffmpeg.stdout.on('data', (data: Buffer) => output.push(data))
    ffmpeg.stderr.on('data', (data: Buffer) => errors.push(data))
    ffmpeg.on('error', (err) => reject(new Error(`Could not run ffmpeg (is it installed?): ${err.message}`)))
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(output))
      else reject(new Error(`ffmpeg exited with ${code}: ${Buffer.concat(errors).toString()}`))
    })
    ffmpeg.stdin.on('error', reject)
    ffmpeg.stdin.end(pcm)
  })
}

export async function synthesizeChunk(text: string, voiceId: string): Promise<SynthesizeResult> {
  const response = await fetch(`${API_BASE}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.openRouterApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.openRouterTtsModel,
      input: text,
      voice: voiceId,
      response_format: 'pcm',
    }),
    signal: AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`OpenRouter TTS failed (${response.status}): ${await response.text()}`)
  }

  const format = parsePcmFormat(response.headers.get('content-type'))
  const pcm = Buffer.from(await response.arrayBuffer())
  if (pcm.length === 0) throw new Error('OpenRouter TTS returned no audio')

  const audioBuffer = await encodeMp3(pcm, format)
  const words = estimateWordTimings(text, pcm, format.sampleRate, format.channels)
  const framedDuration = mp3DurationSeconds(audioBuffer)
  const durationSeconds = framedDuration > 0 ? framedDuration : pcm.length / 2 / format.channels / format.sampleRate

  return { audioBuffer, timing: { words }, durationSeconds }
}

interface SpeechModel {
  id: string
  supported_voices?: string[] | null
}

function displayNameFor(voiceId: string): string {
  return voiceId.charAt(0).toUpperCase() + voiceId.slice(1)
}

// The catalog only changes when OpenRouter adds voices to the model.
const VOICE_CACHE_TTL_MS = 6 * 60 * 60 * 1000
let voiceCache: { model: string; voices: VoiceOption[]; fetchedAt: number } | null = null

/**
 * Voices come from the model listing rather than a hardcoded list. Speech
 * models are absent from the default `/models` response — they only appear
 * when filtered by `output_modalities=speech`.
 */
export async function listVoices(): Promise<VoiceOption[]> {
  const model = env.openRouterTtsModel
  if (voiceCache && voiceCache.model === model && Date.now() - voiceCache.fetchedAt < VOICE_CACHE_TTL_MS) {
    return voiceCache.voices
  }

  const response = await fetch(`${API_BASE}/models?output_modalities=speech`, {
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    throw new Error(`OpenRouter model listing failed (${response.status}): ${await response.text()}`)
  }

  const { data } = (await response.json()) as { data: SpeechModel[] }
  const voiceIds = data.find((entry) => entry.id === model)?.supported_voices
  if (!voiceIds?.length) throw new Error(`OpenRouter lists no voices for ${model}`)

  const voices = voiceIds.map((id) => ({ providerVoiceId: id, displayName: displayNameFor(id) }))
  voiceCache = { model, voices, fetchedAt: Date.now() }
  return voices
}
