import { env } from '../config/env.js'

/**
 * Deploro's project storage API, backed by R2 through a Cloudflare Workers
 * binding. It exposes no S3-compatible endpoint and issues no S3 access
 * keys, so it can't be reached through the S3 adapter no matter how that's
 * configured — hence a separate backend rather than a different S3_ENDPOINT.
 *
 * These routes are siblings of the Studio DB API, not children of it:
 * DEPLORO_API_URL ends in `/studio`, and `/storage/*` sits one level up.
 */

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${env.deploroApiToken}` }
}

function keyUrl(path: string, key: string): string {
  return `${env.deploroStorageUrl}${path}?key=${encodeURIComponent(key)}`
}

async function failure(response: Response, context: string): Promise<Error> {
  const body = await response.text().catch(() => '')
  return new Error(`Deploro storage ${context} failed (${response.status}): ${body}`)
}

export async function putObject(key: string, data: Buffer, contentType: string): Promise<void> {
  const form = new FormData()
  // The multipart filename *is* the storage key — slashes included, so a
  // nested key like `audio/<uuid>/3.mp3` is sent as the filename verbatim.
  // Copied into a plain Uint8Array: a Node Buffer is a view into a shared
  // pool ArrayBuffer, which Blob's typing rejects outright.
  form.append('file', new Blob([new Uint8Array(data)], { type: contentType }), key)

  const response = await fetch(`${env.deploroStorageUrl}/storage/upload`, {
    method: 'POST',
    headers: authHeader(),
    body: form,
  })
  // Writes need a project-admin token; a member-scoped one reads fine and
  // 403s here.
  if (!response.ok) throw await failure(response, `upload of ${key}`)
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const response = await fetch(keyUrl('/storage/download', key), { headers: authHeader() })
  if (!response.ok) throw await failure(response, `download of ${key}`)
  return Buffer.from(await response.arrayBuffer())
}

export async function deleteObject(key: string): Promise<void> {
  const response = await fetch(keyUrl('/storage', key), { method: 'DELETE', headers: authHeader() })
  if (response.status === 404) return
  if (!response.ok) throw await failure(response, `delete of ${key}`)
}
