import { env } from '../config/env.js'

/**
 * Thin wrapper around Deploro's per-project Studio REST API
 * (`/api/projects/:id/studio/*`), used instead of a direct Postgres
 * connection so the backend doesn't require Deploro VPS compute just to
 * reach its own database. Every project table gets `GET/POST /{table}`,
 * `GET/PATCH/DELETE /{table}/{id}` automatically — no ORM, no SQL string
 * building here, matching the plain-fetch style already used for
 * ElevenLabs/Ollama/Readability in services/*.ts.
 */

async function rawRequest(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${env.deploroApiUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.deploroApiToken}`,
      ...init?.headers,
    },
  })
}

async function assertOk(response: Response, context: string): Promise<void> {
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Deploro Studio API ${context} failed (${response.status}): ${body}`)
  }
}

interface ListResponse<T> {
  rows: T[]
  total: number
}

/**
 * Lists rows, optionally filtered by exact-match column values. The Studio
 * API has no server-side sort — callers sort the returned array themselves.
 */
export async function listRows<T>(
  table: string,
  opts?: { filter?: Record<string, string>; limit?: number },
): Promise<T[]> {
  const params = new URLSearchParams()
  params.set('limit', String(opts?.limit ?? 1000))
  for (const [key, value] of Object.entries(opts?.filter ?? {})) {
    params.set(`filter[${key}]`, value)
  }
  const response = await rawRequest(`/${table}?${params.toString()}`)
  await assertOk(response, `list ${table}`)
  const data = (await response.json()) as ListResponse<T>
  return data.rows
}

export async function getRow<T>(table: string, id: string): Promise<T | null> {
  const response = await rawRequest(`/${table}/${id}`)
  if (response.status === 404) return null
  await assertOk(response, `get ${table}/${id}`)
  const data = (await response.json()) as { row: T }
  return data.row
}

export async function insertRow<T>(table: string, data: Record<string, unknown>): Promise<T> {
  const response = await rawRequest(`/${table}`, { method: 'POST', body: JSON.stringify(data) })
  await assertOk(response, `insert into ${table}`)
  const result = (await response.json()) as { row: T }
  return result.row
}

export async function updateRow<T>(table: string, id: string, data: Record<string, unknown>): Promise<T> {
  const response = await rawRequest(`/${table}/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
  await assertOk(response, `update ${table}/${id}`)
  const result = (await response.json()) as { row: T }
  return result.row
}
