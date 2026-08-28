import type { TimingData } from '../types/timing.js'

export interface SynthesizeResult {
  audioBuffer: Buffer
  timing: TimingData
  durationSeconds: number
}

export interface VoiceOption {
  providerVoiceId: string
  displayName: string
  locale?: string
  previewAudioUrl?: string
}

export interface TtsBackend {
  synthesizeChunk(text: string, voiceId: string): Promise<SynthesizeResult>
  listVoices(): Promise<VoiceOption[]>
}

/**
 * Shared ordering for the voice picker: American, then British, then
 * everything else in whatever order the provider returned it. Exported so
 * both the fresh-from-provider path (speechify.ts) and the
 * cached-from-DB fallback path (routes/voices.ts, documentPipeline.ts) rank
 * voices identically instead of drifting apart.
 */
export function regionRank(locale: string | null | undefined): number {
  if (locale === 'en-US') return 0
  if (locale === 'en-GB') return 1
  return 2
}
