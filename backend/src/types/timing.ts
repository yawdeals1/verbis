/** One word's position in the chunk text and its playback window, in milliseconds. */
export interface WordTiming {
  word: string
  charStart: number
  charEnd: number
  startMs: number
  endMs: number
}

export interface TimingData {
  words: WordTiming[]
}
