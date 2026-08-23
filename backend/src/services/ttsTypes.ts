import type { TimingData } from '../types/timing.js'

export interface SynthesizeResult {
  audioBuffer: Buffer
  timing: TimingData
  durationSeconds: number
}

export interface VoiceOption {
  providerVoiceId: string
  displayName: string
}

export interface TtsBackend {
  synthesizeChunk(text: string, voiceId: string): Promise<SynthesizeResult>
  listVoices(): Promise<VoiceOption[]>
  /**
   * Resolves true once the backend can accept a synthesis request again.
   * Only self-hosted backends implement this — a hosted API is either up or
   * returns an error, but a container can be killed and spend a minute
   * reloading its model before it listens again.
   */
  waitUntilReady?(timeoutMs: number): Promise<boolean>
}
