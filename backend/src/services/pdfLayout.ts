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
  /** First line of a detected section (row) or column — forces a paragraph break downstream, since a plain y-gap check can't tell "next column" from "next line" once reading order stops being monotonic in y. */
  blockStart: boolean
}

/** Gap (relative to the page's typical fragment height) big enough to mark a section break rather than ordinary line spacing. */
const BAND_GAP_FACTOR = 1.8
/** Gap (relative to typical fragment height) big enough to mark a column gutter. Much larger than a word space or the letter-run gap ratios above, which operate within a single line. */
const COLUMN_GAP_FACTOR = 2.5
/** A column candidate must span at least this fraction of its band's height to count as a real column, not one stray indented fragment. */
const MIN_COLUMN_HEIGHT_COVERAGE = 0.3

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Merges sorted-ascending [start, end] intervals wherever they overlap or touch. */
function mergeCoveredIntervals(intervals: [number, number][]): [number, number][] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    if (sorted[i][0] <= last[1]) last[1] = Math.max(last[1], sorted[i][1])
    else merged.push(sorted[i])
  }
  return merged
}

/**
 * Splits a page's fragments into vertical bands (rows/sections) using a
 * projection of what y-ranges have any text at all — a gap in that
 * projection much bigger than ordinary line spacing marks a section break
 * (e.g. the whitespace between a heading and a row of cards below it).
 * Returns bands in top-to-bottom reading order.
 */
function splitIntoBands(fragments: Fragment[]): Fragment[][] {
  if (fragments.length === 0) return []
  const lineHeight = median(fragments.map((f) => f.height)) || 1
  const covered = mergeCoveredIntervals(fragments.map((f): [number, number] => [f.yTop, f.yTop + f.height]))

  const bands: [number, number][] = [covered[0]]
  for (let i = 1; i < covered.length; i++) {
    const gap = covered[i][0] - bands[bands.length - 1][1]
    if (gap > lineHeight * BAND_GAP_FACTOR) bands.push(covered[i])
    else bands[bands.length - 1][1] = Math.max(bands[bands.length - 1][1], covered[i][1])
  }

  // y-up coordinates: higher yTop reads first, so top-to-bottom is descending.
  bands.sort((a, b) => b[1] - a[1])
  return bands.map(([bottom, top]) => fragments.filter((f) => f.yTop >= bottom - 0.01 && f.yTop + f.height <= top + 0.01))
}

/**
 * Splits one band into left-to-right columns using the same projection
 * technique on the x-axis — a wide horizontal gap spanning most of the
 * band's height marks a column gutter (e.g. two cards sitting side by
 * side). Falls back to a single column (the whole band, unchanged) unless
 * a clean 2+-way split is found, so ordinary single-column text is
 * unaffected.
 */
function splitBandIntoColumns(fragments: Fragment[]): Fragment[][] {
  if (fragments.length === 0) return [fragments]
  const lineHeight = median(fragments.map((f) => f.height)) || 1
  const bandTop = Math.max(...fragments.map((f) => f.yTop + f.height))
  const bandBottom = Math.min(...fragments.map((f) => f.yTop))
  const bandHeight = bandTop - bandBottom || 1

  const covered = mergeCoveredIntervals(fragments.map((f): [number, number] => [f.x, f.x + f.width]))
  const columnRanges: [number, number][] = [covered[0]]
  for (let i = 1; i < covered.length; i++) {
    const gap = covered[i][0] - columnRanges[columnRanges.length - 1][1]
    if (gap > lineHeight * COLUMN_GAP_FACTOR) columnRanges.push(covered[i])
    else columnRanges[columnRanges.length - 1][1] = Math.max(columnRanges[columnRanges.length - 1][1], covered[i][1])
  }
  if (columnRanges.length < 2) return [fragments]

  const columns = columnRanges.map(([left, right]) => fragments.filter((f) => f.x >= left - 0.01 && f.x + f.width <= right + 0.01))
  const spansEnoughHeight = columns.every((col) => {
    const top = Math.max(...col.map((f) => f.yTop + f.height))
    const bottom = Math.min(...col.map((f) => f.yTop))
    return (top - bottom) / bandHeight >= MIN_COLUMN_HEIGHT_COVERAGE
  })
  return spansEnoughHeight ? columns : [fragments]
}

async function extractPageLines(page: pdfjsLib.PDFPageProxy): Promise<{ lines: PageLineData[]; width: number; height: number }> {
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()

  const fragments: Fragment[] = []
  for (const item of content.items) {
    if (!isTextItem(item)) continue
    fragments.push(...itemToFragments(item))
  }

  // Reading order isn't simply top-to-bottom across the full page width —
  // side-by-side blocks (e.g. two cards in a row) need to be read fully
  // before moving to the next one, not interleaved by y position the way a
  // single global sort would. Band the page into rows, then split each row
  // into columns where the fragments clearly form separate blocks; each
  // band/column is grouped into lines independently so cross-column
  // fragments never end up sorted into the same line.
  const lines: PageLineData[] = []
  for (const band of splitIntoBands(fragments)) {
    for (const column of splitBandIntoColumns(band)) {
      groupIntoLines(column).forEach((line, i) => {
        lines.push({ tokens: mergeLetterRuns(line), yTop: line[0].yTop, blockStart: i === 0 })
      })
    }
  }

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
      // Column transitions jump back upward in y (the next column's first
      // line starts higher than the previous column's last line), so those
      // gaps would corrupt a "typical line spacing" measure — exclude them
      // (blockStart already forces a paragraph break there regardless).
      const gaps: number[] = []
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].blockStart) continue
        gaps.push(lines[i - 1].yTop - lines[i].yTop)
      }
      const medianGap = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0

      lines.forEach((line, lineIndex) => {
        const isFirstLineOfPage = lineIndex === 0
        const gapFromPrev = lineIndex > 0 ? lines[lineIndex - 1].yTop - line.yTop : 0
        const isNewParagraph = isFirstLineOfPage
          ? pageIndex > 0
          : line.blockStart || (medianGap > 0 && gapFromPrev > medianGap * PARAGRAPH_GAP_FACTOR)

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
