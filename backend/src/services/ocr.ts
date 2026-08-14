import { ImageAnnotatorClient } from '@google-cloud/vision'
import { env } from '../config/env.js'

let client: ImageAnnotatorClient | undefined

function getClient(): ImageAnnotatorClient {
  // Referencing env.googleCloudVisionCredentials throws if unset, which is
  // what we want here — this getter is only called when a scan is actually
  // uploaded, not at module load time.
  env.googleCloudVisionCredentials
  if (!client) {
    client = new ImageAnnotatorClient()
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
