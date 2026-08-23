import { env } from '../config/env.js'
import * as elevenlabs from './elevenlabs.js'
import * as kokoro from './kokoro.js'
import type { SynthesizeResult, VoiceOption } from './ttsTypes.js'

export type { SynthesizeResult, VoiceOption }

/**
 * Single seam between the pipeline and whichever TTS backend is active.
 *
 * Both providers return the same character-anchored `WordTiming[]`, so
 * nothing downstream (chunk storage, tap-to-jump, merged playback) knows or
 * cares which one produced a chunk. Switching is one env var, which is the
 * point: `documents.voice_id` already carries a `provider` column, so audio
 * generated under one provider stays valid after a switch — only newly
 * generated chunks use the new backend.
 */
const providers = {
  kokoro,
  elevenlabs,
}

export type TtsProvider = keyof typeof providers

export function activeProvider(): TtsProvider {
  return env.ttsProvider
}

export async function synthesizeChunk(text: string, voiceId: string): Promise<SynthesizeResult> {
  const provider = activeProvider()
  const started = Date.now()

  const result = await providers[provider].synthesizeChunk(text, voiceId)

  // The one number that was missing when the ElevenLabs bill was a surprise:
  // characters billed, per call, with the realtime factor next to it so a
  // CPU-bound backend that has fallen behind playback speed is visible.
  const elapsedSeconds = (Date.now() - started) / 1000
  const realtimeFactor = elapsedSeconds > 0 ? result.durationSeconds / elapsedSeconds : 0
  console.log(
    `[tts] provider=${provider} chars=${text.length} audio=${result.durationSeconds.toFixed(1)}s ` +
      `took=${elapsedSeconds.toFixed(1)}s rtf=${realtimeFactor.toFixed(2)}x`,
  )

  return result
}

export async function listVoices(): Promise<VoiceOption[]> {
  return providers[activeProvider()].listVoices()
}
