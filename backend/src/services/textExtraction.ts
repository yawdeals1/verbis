import { PDFParse } from 'pdf-parse'
import * as mammoth from 'mammoth'
import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'
import { convert as htmlToText } from 'html-to-text'
import path from 'node:path'

/** PDF text extraction, preserving reading order per page (PRODUCT_PLAN.md §7). */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    return result.pages.map((page) => page.text.trim()).filter(Boolean).join('\n\n')
  } finally {
    await parser.destroy()
  }
}

/** DOCX text extraction via mammoth, preserving paragraph structure. */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer })
  return result.value.trim()
}

/** Plain text import — normalize line endings, collapse to paragraph breaks. */
export function extractTxtText(buffer: Buffer): string {
  return buffer
    .toString('utf-8')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

interface ManifestItem {
  id: string
  href: string
  mediaType: string
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * EPUB text extraction: unzip, read the OPF manifest/spine to find reading
 * order, then strip HTML from each spine document. Implemented directly
 * against the EPUB container format (rather than a third-party EPUB
 * library) to avoid depending on an unmaintained parser for something this
 * mechanical.
 */
export async function extractEpubText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

  const containerXml = await zip.file('META-INF/container.xml')?.async('string')
  if (!containerXml) throw new Error('Invalid EPUB: missing META-INF/container.xml')
  const container = xmlParser.parse(containerXml)
  const opfPath: string = container.container.rootfiles.rootfile['@_full-path']

  const opfXml = await zip.file(opfPath)?.async('string')
  if (!opfXml) throw new Error(`Invalid EPUB: missing OPF at ${opfPath}`)
  const opf = xmlParser.parse(opfXml)
  const opfDir = path.dirname(opfPath)

  const manifestItems: ManifestItem[] = asArray(opf.package.manifest.item).map((item) => ({
    id: item['@_id'],
    href: item['@_href'],
    mediaType: item['@_media-type'],
  }))
  const manifestById = new Map(manifestItems.map((item) => [item.id, item]))

  const spineIdrefs: string[] = asArray(opf.package.spine.itemref).map((ref) => ref['@_idref'])

  const sections: string[] = []
  for (const idref of spineIdrefs) {
    const item = manifestById.get(idref)
    if (!item || !/html|xml/.test(item.mediaType)) continue

    const filePath = path.posix.join(opfDir, item.href)
    const html = await zip.file(filePath)?.async('string')
    if (!html) continue

    const text = htmlToText(html, { wordwrap: false, selectors: [{ selector: 'img', format: 'skip' }] }).trim()
    if (text) sections.push(text)
  }

  return sections.join('\n\n')
}
