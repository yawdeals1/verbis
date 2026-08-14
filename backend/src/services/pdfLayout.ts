// The generic `pdfjs-dist` entry needs browser DOM globals (DOMMatrix, etc.)
// that don't exist in Node — the package itself warns to use this build here.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { resolveAmbiguousWordBreaks, type AmbiguousWordPair } from './ollama.js'

// Without these, pdf.js can't compute accurate glyph widths/advances for
// PDFs that reference the standard 14 fonts (Helvetica, Times, etc.) without
// embedding them, or for CJK text — both matter for the word-gap geometry
// this module depends on, not just rendering. pdf.js's Node-side loader
// reads these as plain filesystem paths (not `file://` URLs — Node's fetch
// doesn't support that scheme, which is what a `file://` URL here hits).
const pdfjsDistDir = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
// pdf.js requires a trailing "/" specifically (URL-style), not path.sep — a
// Windows "\" here fails its "must include trailing slash" check.
const standardFontDataUrl = `${path.join(pdfjsDistDir, 'standard_fonts').replace(/\\/g, '/')}/`
const cMapUrl = `${path.join(pdfjsDistDir, 'cmaps').replace(/\\/g, '/')}/`

export interface PdfPage {
  pageNumber: number
  width: number
  height: number
}

export interface PdfWordPosition {
  charStart: number
  charEnd: number
  page: number
  /** All four fields are fractions (0..1) of the page's width/height, top-left origin. */
  x: number
  y: number
  width: number
  height: number
}

export interface PdfLayout {
  text: string
  words: PdfWordPosition[]
  pages: PdfPage[]
}

/** A raw pdf.js text item, narrowed from `TextItem | TextMarkedContent` (which has no `str`). */
interface RawTextItem {
  str: string
  transform: number[]
  width: number
  height: number
}

function isTextItem(item: unknown): item is RawTextItem {
  return typeof item === 'object' && item !== null && 'str' in item && typeof (item as RawTextItem).str === 'string'
}

/** One piece of text on a page with a known position — either a whole pdf.js item, or a slice of one that had internal whitespace. */
export interface Fragment {
  text: string
  x: number
  yTop: number
  width: number
  height: number
  fontSize: number
}

const LINE_Y_TOLERANCE_FACTOR = 0.4
const PARAGRAPH_GAP_FACTOR = 1.4
/** Gap ratio (of font size) below which two fragments in a decorative single-letter run are still considered part of it. Generous, since run membership is primarily gated on fragment length (single characters), not distance. */
const RUN_GAP_RATIO = 0.5
/** Gap ratio below which an adjacent pair of already-reconstructed words is flagged for AI review rather than assumed separate. */
const AMBIGUOUS_GAP_RATIO = 0.3

/**
 * pdfjs-dist v5 removed `disableCombineTextItems` — there is no public API
 * for raw, unmerged glyph positions. By the time `getTextContent()` returns,
 * pdf.js has already decided, per its own internal `TRACKING_SPACE_FACTOR`
 * heuristic (fontSize * 0.102), where to flush a run into a new item — which
 * is what fragments decorative/letter-tracked headings into a stream of
 * single-character items in the first place (the letter-spacing bug). We
 * can't redo that decision from scratch, so instead we reclassify pdf.js's
 * own item boundaries: a *run* of 3+ consecutive single-character items is
 * treated as one mis-split word and merged back together, since ordinary
 * prose essentially never produces that pattern on its own. Genuinely
 * ambiguous adjacent-word boundaries (produced by two merged runs sitting
 * close together, e.g. "FOR" + "DEVELOPERS") are deferred to
 * `resolveAmbiguousWordBreaks` rather than guessed.
 */
function itemToFragments(item: RawTextItem): Fragment[] {
  const [a, b, , , e, f] = item.transform
  const fontSize = Math.max(Math.hypot(a, b), 1)
  const parts = item.str.split(/(\s+)/).filter((p) => p.length > 0)
  if (parts.length <= 1) {
    const text = item.str.trim()
    if (!text) return []
    return [{ text, x: e, yTop: f, width: item.width, height: item.height, fontSize }]
  }

  // Item has internal whitespace (pdf.js sometimes appends a "fake space"
  // into the same item rather than flushing) — split on it, approximating
  // each token's position proportionally by its share of the item's total
  // character count. Approximate, but this case is rare in practice.
  const totalChars = item.str.length
  const fragments: Fragment[] = []
  let consumed = 0
  for (const part of parts) {
    const isSpace = /^\s+$/.test(part)
    if (!isSpace) {
      const startFrac = consumed / totalChars
      const widthFrac = part.length / totalChars
      fragments.push({
        text: part,
        x: e + startFrac * item.width,
        yTop: f,
        width: widthFrac * item.width,
        height: item.height,
        fontSize,
      })
    }
    consumed += part.length
  }
  return fragments
}

export function groupIntoLines(fragments: Fragment[]): Fragment[][] {
  const sorted = [...fragments].sort((a, b) => b.yTop - a.yTop || a.x - b.x)
  const lines: Fragment[][] = []
  for (const fragment of sorted) {
    const line = lines.at(-1)
    const last = line?.at(-1)
    if (line && last && Math.abs(fragment.yTop - last.yTop) <= last.height * LINE_Y_TOLERANCE_FACTOR) {
      line.push(fragment)
    } else {
      lines.push([fragment])
    }
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x)
  return lines
}

interface WordToken {
  text: string
  x: number
  yTop: number
  width: number
  height: number
  /** True if this token was reconstructed from a run of single-character fragments (candidate for AI review against its neighbor). */
  reconstructed: boolean
}

/** Merges runs of 3+ consecutive single-character fragments (the decorative-letter-spacing pattern) within one line into single word tokens. */
export function mergeLetterRuns(line: Fragment[]): WordToken[] {
  const tokens: WordToken[] = []
  let i = 0
  while (i < line.length) {
    const start = i
    let j = i
    while (j < line.length && line[j].text.length === 1) {
      if (j > start) {
        const gapRatio = (line[j].x - (line[j - 1].x + line[j - 1].width)) / line[j].fontSize
        if (gapRatio > RUN_GAP_RATIO) break
      }
      j++
    }
    const runLength = j - start
    if (runLength >= 3) {
      const run = line.slice(start, j)
      const x = Math.min(...run.map((f) => f.x))
      const right = Math.max(...run.map((f) => f.x + f.width))
      tokens.push({
        text: run.map((f) => f.text).join(''),
        x,
        yTop: run[0].yTop,
        width: right - x,
        height: run[0].height,
        reconstructed: true,
      })
      i = j
    } else {
      const f = line[start]
      tokens.push({ text: f.text, x: f.x, yTop: f.yTop, width: f.width, height: f.height, reconstructed: false })
      i = start + 1
    }
  }
  return tokens
}

interface PageLineData {
  tokens: WordToken[]
  yTop: number
}

async function extractPageLines(page: pdfjsLib.PDFPageProxy): Promise<{ lines: PageLineData[]; width: number; height: number }> {
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()

  const fragments: Fragment[] = []
  for (const item of content.items) {
    if (!isTextItem(item)) continue
    fragments.push(...itemToFragments(item))
  }

  const lines = groupIntoLines(fragments).map((line) => ({
    tokens: mergeLetterRuns(line),
    yTop: line[0].yTop,
  }))

  return { lines, width: viewport.width, height: viewport.height }
}

interface PendingAmbiguity {
  id: string
  leftToken: { pageIndex: number; lineIndex: number; tokenIndex: number }
  rightToken: { pageIndex: number; lineIndex: number; tokenIndex: number }
}

export async function extractPdfLayout(buffer: Buffer): Promise<PdfLayout> {
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl,
    cMapUrl,
    cMapPacked: true,
  }).promise
  try {
    const pages: PdfPage[] = []
    const pageLines: PageLineData[][] = []

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber)
      const { lines, width, height } = await extractPageLines(page)
      pages.push({ pageNumber, width, height })
      pageLines.push(lines)
    }

    // Flag ambiguous adjacent-word boundaries for AI review before building
    // the final text, so their (possibly merged) result is what gets
    // assembled — not a second pass over already-built text.
    const ambiguities: PendingAmbiguity[] = []
    const ambiguityPairs: AmbiguousWordPair[] = []
    pageLines.forEach((lines, pageIndex) => {
      lines.forEach((line, lineIndex) => {
        for (let t = 1; t < line.tokens.length; t++) {
          const prev = line.tokens[t - 1]
          const curr = line.tokens[t]
          if (!prev.reconstructed && !curr.reconstructed) continue
          const fontSize = Math.max(prev.height, curr.height)
          const gapRatio = (curr.x - (prev.x + prev.width)) / fontSize
          if (gapRatio < AMBIGUOUS_GAP_RATIO) {
            const id = `${pageIndex}-${lineIndex}-${t}`
            ambiguities.push({
              id,
              leftToken: { pageIndex, lineIndex, tokenIndex: t - 1 },
              rightToken: { pageIndex, lineIndex, tokenIndex: t },
            })
            ambiguityPairs.push({ id, first: prev.text, second: curr.text })
          }
        }
      })
    })

    const mergeDecisions = await resolveAmbiguousWordBreaks(ambiguityPairs)

    // Apply merges back-to-front per line so earlier token indices stay valid.
    const byLine = new Map<string, PendingAmbiguity[]>()
    for (const amb of ambiguities) {
      if (!mergeDecisions.get(amb.id)) continue
      const key = `${amb.leftToken.pageIndex}-${amb.leftToken.lineIndex}`
      const list = byLine.get(key) ?? []
      list.push(amb)
      byLine.set(key, list)
    }
    for (const [key, ambs] of byLine) {
      const [pageIndex, lineIndex] = key.split('-').map(Number)
      const tokens = pageLines[pageIndex][lineIndex].tokens
      ambs
        .sort((a, b) => b.rightToken.tokenIndex - a.rightToken.tokenIndex)
        .forEach((amb) => {
          const li = amb.leftToken.tokenIndex
          const ri = amb.rightToken.tokenIndex
          const left = tokens[li]
          const right = tokens[ri]
          if (!left || !right) return
          tokens.splice(li, ri - li + 1, {
            text: left.text + right.text,
            x: Math.min(left.x, right.x),
            yTop: left.yTop,
            width: Math.max(left.x + left.width, right.x + right.width) - Math.min(left.x, right.x),
            height: Math.max(left.height, right.height),
            reconstructed: true,
          })
        })
    }

    // Assemble canonical text + word positions, tracking char offsets and
    // paragraph breaks (a line-gap noticeably larger than the page's
    // typical line spacing, or a page boundary, starts a new paragraph).
    let text = ''
    const words: PdfWordPosition[] = []

    pageLines.forEach((lines, pageIndex) => {
      const page = pages[pageIndex]
      const gaps: number[] = []
      for (let i = 1; i < lines.length; i++) gaps.push(lines[i - 1].yTop - lines[i].yTop)
      const medianGap = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0

      lines.forEach((line, lineIndex) => {
        const isFirstLineOfPage = lineIndex === 0
        const gapFromPrev = lineIndex > 0 ? lines[lineIndex - 1].yTop - line.yTop : 0
        const isNewParagraph = isFirstLineOfPage ? pageIndex > 0 : medianGap > 0 && gapFromPrev > medianGap * PARAGRAPH_GAP_FACTOR

        if (text.length > 0) text += isNewParagraph ? '\n\n' : ' '

        line.tokens.forEach((token, tokenIndex) => {
          if (tokenIndex > 0) text += ' '
          const charStart = text.length
          text += token.text
          words.push({
            charStart,
            charEnd: text.length,
            page: page.pageNumber,
            x: token.x / page.width,
            // token.yTop is the PDF baseline (y-up from the bottom of the
            // page); the glyph box extends upward from it by `height`, so
            // the top-down fraction is measured from (yTop + height).
            y: (page.height - (token.yTop + token.height)) / page.height,
            width: token.width / page.width,
            height: token.height / page.height,
          })
        })
      })
    })

    return { text, words, pages }
  } finally {
    await doc.destroy()
  }
}
