// Sized for time-to-first-audio, not for the TTS request size (Kokoro
// sub-splits internally — see TARGET_MAX_TOKENS in deploro.compose.yml).
// Self-hosted CPU synthesis runs at well under realtime on a shared box, so
// a 1000-char chunk meant a couple of minutes before playback could start,
// and lost that much work whenever a chunk had to be retried.
const MAX_CHUNK_CHARS = 400

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

export interface ChunkSplit {
  text: string
  /** This chunk's starting offset within the `text` passed into splitIntoChunks. Exact for input already in the "single space within a paragraph, \n\n between paragraphs" canonical form (e.g. pdfLayout.ts's output) — that's a byte-for-byte identity transform through this function, which is what pdfLayout.ts's own word charStart/charEnd offsets are anchored to. */
  charStart: number
}

/**
 * Groups paragraph text into sentence-aligned chunks, each up to
 * MAX_CHUNK_CHARS — small enough to keep TTS requests fast and seekable
 * (PRODUCT_PLAN.md §5 risk: chunking strategy), large enough to keep the
 * per-document chunk/API-call count reasonable.
 */
export function splitIntoChunks(text: string, maxChars = MAX_CHUNK_CHARS): ChunkSplit[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  const chunks: ChunkSplit[] = []
  let current = ''
  let currentStart = 0
  // Tracks true position in `text` independently of `current` — a flush can
  // leave a separator "orphaned" between two chunks (belongs to neither
  // chunk's text, but still occupies space in the source), so this can't
  // just be derived from chunks' accumulated lengths.
  let cursor = 0
  let hasEmittedAny = false

  const flush = () => {
    if (current.trim()) chunks.push({ text: current.trim(), charStart: currentStart })
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
        if (hasEmittedAny) cursor += separator.length

        const candidate = current ? `${current}${separator}${sentence}` : sentence
        if (candidate.length > maxChars && current) {
          flush()
          currentStart = cursor
          current = sentence
        } else {
          if (!current) currentStart = cursor
          current = candidate
        }
        cursor += sentence.length
        isFirstSentenceOfParagraph = false
        hasEmittedAny = true
      }
    }
    // Prefer a paragraph break as a chunk boundary when there's room left,
    // so chunks don't straddle unrelated paragraphs unnecessarily.
    if (current.length > maxChars * 0.6) flush()
  }
  flush()

  return chunks
}
