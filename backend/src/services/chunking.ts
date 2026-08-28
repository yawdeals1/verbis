// Sized against spoken pace (~150 wpm, ~5.7 chars/word incl. the trailing
// space -> ~14 chars/sec) to land each chunk in the 45s-2min range: short
// enough to start playback fast and keep seeking within a chunk cheap, long
// enough that per-chunk reloads (see the "merge all sections" seam in
// useReaderPlayback.ts) aren't constant. Speechify is a hosted API with no
// per-request memory constraint to size against, unlike the old self-hosted
// Kokoro backend this replaced — that's what allowed raising this at all.
// Ceiling, not just a preference: Speechify caps SSML input at 2000 chars of
// actual text (5000 including tags), and speechify.ts wraps every chunk in
// `<speak>...</speak>` before sending it — this has to stay well under that
// or synthesis starts failing outright.
const MAX_CHUNK_CHARS = 1200

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
