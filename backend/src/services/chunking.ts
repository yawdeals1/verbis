const MAX_CHUNK_CHARS = 1000

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z0-9"'“(])/

function splitIntoSentences(paragraph: string): string[] {
  return paragraph
    .split(SENTENCE_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean)
}

function hardSplit(sentence: string, maxChars: number): string[] {
  const words = sentence.split(/\s+/)
  const parts: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxChars && current) {
      parts.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) parts.push(current)
  return parts
}

/**
 * Groups paragraph text into sentence-aligned chunks, each up to
 * MAX_CHUNK_CHARS — small enough to keep TTS requests fast and seekable
 * (PRODUCT_PLAN.md §5 risk: chunking strategy), large enough to keep the
 * per-document chunk/API-call count reasonable.
 */
export function splitIntoChunks(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  const chunks: string[] = []
  let current = ''

  const flush = () => {
    if (current.trim()) chunks.push(current.trim())
    current = ''
  }

  for (const paragraph of paragraphs) {
    let isFirstSentenceOfParagraph = true
    for (const rawSentence of splitIntoSentences(paragraph)) {
      const sentences = rawSentence.length > maxChars ? hardSplit(rawSentence, maxChars) : [rawSentence]

      for (const sentence of sentences) {
        // A paragraph's first sentence joins prior content with a blank-line
        // marker (kept in the chunk text itself) so the frontend can render
        // paragraph breaks instead of one run-on wall of text — ElevenLabs
        // treats "\n\n" as ordinary whitespace, so it doesn't affect timing.
        const separator = isFirstSentenceOfParagraph ? '\n\n' : ' '
        const candidate = current ? `${current}${separator}${sentence}` : sentence
        if (candidate.length > maxChars && current) {
          flush()
          current = sentence
        } else {
          current = candidate
        }
        isFirstSentenceOfParagraph = false
      }
    }
    // Prefer a paragraph break as a chunk boundary when there's room left,
    // so chunks don't straddle unrelated paragraphs unnecessarily.
    if (current.length > maxChars * 0.6) flush()
  }
  flush()

  return chunks
}
