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
}
