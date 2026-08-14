import { ImageAnnotatorClient } from '@google-cloud/vision'
import { env } from '../config/env.js'

let client: ImageAnnotatorClient | undefined

function getClient(): ImageAnnotatorClient {
  if (!client) {
    // Passed explicitly rather than relying on the client's own
    // GOOGLE_APPLICATION_CREDENTIALS env lookup — env.googleCloudVisionCredentials
    // may resolve to a temp file it just wrote (from GOOGLE_APPLICATION_CREDENTIALS_JSON),
    // which nothing else points the env var at.
    client = new ImageAnnotatorClient({ keyFilename: env.googleCloudVisionCredentials })
  }
  return client
}

/**
 * Runs Document Text Detection (PRODUCT_PLAN.md §2) on a photographed book
 * page. Chosen over generic text detection because it preserves reading
 * order on dense printed-text photos.
 */
export async function extractTextFromImage(buffer: Buffer): Promise<string> {
  const [result] = await getClient().documentTextDetection({ image: { content: buffer } })
  return result.fullTextAnnotation?.text?.trim() ?? ''
}
