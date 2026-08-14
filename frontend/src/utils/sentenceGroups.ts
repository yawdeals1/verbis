const SENTENCE_END = /[.!?]["')]*$/

/** Assigns each word to a sentence index by detecting trailing sentence-ending punctuation. */
export function computeSentenceGroups(words: { word: string }[]): number[] {
  const groups: number[] = []
  let sentence = 0
  for (const w of words) {
    groups.push(sentence)
    if (SENTENCE_END.test(w.word)) sentence += 1
  }
  return groups
}
