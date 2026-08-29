import { env } from '../config/env.js'

/**
 * Server-to-server client for Deploro Auth-as-a-Service's per-project
 * end-user endpoints (`/auth/:slug/*` on the Deploro worker itself, and the
 * admin-only `/api/projects/:id/auth/users` endpoint). Plain fetch, same
 * style as services/ollama.ts — no SDK.
 *
 * The session Deploro issues is an HttpOnly cookie scoped to the Deploro
 * worker's own domain (`gallium_project_session_<slug>`), not to Verbis's
 * domain, and there is no bearer token in the login response body. So
 * Verbis's backend holds that cookie value itself (as the opaque payload of
 * its own `verbis_session` cookie) and forwards it as a `Cookie` header on
 * every server-to-server call here — this works from any server context,
 * unlike the browser, which is subject to SameSite and cross-origin rules
 * the Deploro cookie was never designed to survive outside its own domain.
 */

const SESSION_COOKIE_NAME = `gallium_project_session_${env.deploroAuthSlug}`

function authUrl(path: string): string {
  return `${env.deploroAuthBaseUrl}/auth/${env.deploroAuthSlug}${path}`
}

function extractSessionToken(response: Response): string | null {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) return null
  const match = new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`).exec(setCookie)
  return match ? match[1] : null
}

export interface DeploroAuthUser {
  id: string
  email: string
  name: string | null
  avatarUrl: string | null
  provider: string
}

function mapUser(raw: { id: string; email: string; name?: string | null; avatar_url?: string | null; provider: string }): DeploroAuthUser {
  return { id: raw.id, email: raw.email, name: raw.name ?? null, avatarUrl: raw.avatar_url ?? null, provider: raw.provider }
}

export class DeploroAuthError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Logs in against Deploro's email+password provider. Returns the session token to store, plus the identity. Throws DeploroAuthError(401) on bad credentials. */
export async function login(email: string, password: string): Promise<{ token: string; user: DeploroAuthUser }> {
  const response = await fetch(authUrl('/email-password/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({}) as { error?: string })
    throw new DeploroAuthError(response.status, body.error ?? 'Login failed')
  }

  const token = extractSessionToken(response)
  if (!token) throw new Error('Deploro login succeeded but returned no session cookie')

  const body = (await response.json()) as { user: Parameters<typeof mapUser>[0] }
  return { token, user: mapUser(body.user) }
}

/** Validates a previously-issued session token server-to-server. Returns null if invalid/expired rather than throwing — callers treat that as "not logged in". */
export async function validateSession(token: string): Promise<DeploroAuthUser | null> {
  const response = await fetch(authUrl('/session'), {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
  })
  if (!response.ok) return null
  const body = (await response.json()) as { user: Parameters<typeof mapUser>[0] }
  return mapUser(body.user)
}

export async function requestPasswordReset(email: string): Promise<void> {
  await fetch(authUrl('/email-password/request-reset'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  // Always {"ok":true} regardless of whether the email has an account — not
  // worth distinguishing here, same as Deploro's own endpoint.
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const response = await fetch(authUrl('/email-password/reset'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}) as { error?: string })
    throw new DeploroAuthError(response.status, body.error ?? 'Reset failed')
  }
}

/**
 * Self-service signup against Deploro's email+password provider — used by
 * the "accept your invite" flow. This is deliberately NOT the admin-add
 * endpoint: verified live against the deployed worker that admin-added end
 * users only get a passwordless `email` (OTP) identity, and that the
 * invitee still has to run this same signup call themselves to attach a
 * password credential before `/login` will accept one — so admin-add would
 * just be a redundant extra confirmation email with no functional benefit.
 * Deploro end users are unique per (project, email), so this reuses the
 * same underlying identity if one already exists (e.g. from OAuth).
 * Always `{ok:true}`; Deploro emails a confirmation link regardless.
 */
export async function signup(email: string, password: string, name: string): Promise<void> {
  const response = await fetch(authUrl('/email-password/signup'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}) as { error?: string })
    throw new DeploroAuthError(response.status, body.error ?? 'Signup failed')
  }
}
