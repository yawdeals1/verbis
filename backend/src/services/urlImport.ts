import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'

const PRIVATE_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^\[::1\]$/,
]

/** Basic SSRF guard: only allow http(s) requests to what looks like a public hostname. Not exhaustive (no DNS-rebinding protection), but this is a personal single-user tool, not a multi-tenant fetch proxy. */
function assertSafePublicUrl(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('Invalid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http/https URLs are supported')
  }
  if (PRIVATE_HOSTNAME_PATTERNS.some((pattern) => pattern.test(url.hostname))) {
    throw new Error('URLs pointing at local/private addresses are not allowed')
  }
  return url
}

export interface UrlExtractionResult {
  title: string
  text: string
}

/**
 * Web page import (PRODUCT_PLAN.md §5, Phase 3 P1): fetch a URL and strip it
 * to reader-mode text via Readability, the same approach browsers use for
 * "reader view" — keeps the article body, drops nav/ads/boilerplate.
 */
export async function extractFromUrl(rawUrl: string): Promise<UrlExtractionResult> {
  const url = assertSafePublicUrl(rawUrl)

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VerbisReader/1.0)' },
    redirect: 'follow',
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch URL (${response.status})`)
  }
  const html = await response.text()

  const dom = new JSDOM(html, { url: url.toString() })
  const article = new Readability(dom.window.document).parse()

  if (!article?.textContent?.trim()) {
    throw new Error('Could not extract readable article text from this page')
  }

  return { title: article.title || url.hostname, text: article.textContent.trim() }
}
