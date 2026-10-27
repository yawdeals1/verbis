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
 * Deliberately not derived from word timing: there is trailing silence
 * after the final word, and `durationSeconds` is what
 * useReaderPlayback.ts accumulates into `chunkOffsetsMs` to locate each
 * chunk inside the merged file. Under-reporting here would not just mistime
 * one chunk, it would shift every later chunk by the accumulated error.
 */
export function mp3DurationSeconds(buffer: Buffer): number {
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
