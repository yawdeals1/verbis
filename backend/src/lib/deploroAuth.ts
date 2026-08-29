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

// NOTE: verified live (repeatedly, across unconfirmed/confirmed/logged-in
// identities, and with the `email` OTP provider both on and off) that
// Deploro never actually delivers a reset email for this project, despite
// always returning {"ok":true}. Kept as a correct implementation of
// Deploro's documented contract, but the invite flow (routes/auth.ts's
// `/accept-invite`) deliberately does NOT depend on this working, since it
// currently doesn't. Worth revisiting if Deploro fixes it, or ask their
// support — nothing on the Verbis side can route around a provider-side
// email delivery gap for this endpoint specifically.
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
 * Self-service signup against Deploro's email+password provider — the ONLY
 * reliable way (verified live, many times) to get someone from "invited" to
 * "can actually log in": the password given here is permanent from the
 * user's perspective, since there is no working way to change it
 * afterwards (see requestPasswordReset above) — re-calling signup on an
 * already-confirmed identity is a silent no-op, it does not update the
 * password. So this must always be called with the password the invitee
 * themselves chose, via routes/auth.ts's `/accept-invite`, never a
 * throwaway. Re-calling it on a still-*unconfirmed* identity IS safe and
 * resends a fresh confirmation email (verified live) — that's what makes
 * accept-invite idempotent if someone submits the form twice.
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

function adminAuthUrl(path: string): string {
  return `${env.deploroApiUrl.replace(/\/studio$/, '')}/auth${path}`
}

function adminAuthHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${env.deploroApiToken}` }
}

/**
 * Admin-only: creates a passwordless `email` (OTP) identity purely to
 * trigger Deploro's "Confirm your account" email as the invite
 * notification (`POST /api/projects/:id/auth/users`, project-admin PAT,
 * not an end-user session). This identity is never used for sign-in —
 * Verbis only supports email+password, and clicking this email's link only
 * confirms the harmless OTP identity, never touching any password — it
 * exists solely to get one real email into the invitee's inbox pointing
 * them at `/welcome`, where they choose their password themselves (see
 * routes/auth.ts's `/accept-invite`, which calls `signup` above for the
 * credential that actually matters).
 *
 * This is NOT how the invite email used to be sent — an earlier version
 * called `signup` with a random throwaway password instead. That was a
 * real bug: clicking "Confirm your account" finalizes whatever password
 * was in the signup call, permanently (re-signup on a confirmed identity
 * is a silent no-op — see `signup` above), and `requestPasswordReset`
 * doesn't work (verified live, extensively) — so a throwaway password
 * meant the invitee could get permanently locked out with no recovery.
 * admin-add can't lock anyone out this way, since it never sets a password
 * at all.
 *
 * 409s if an end user already exists for this email — that's expected on
 * every resend (see `sendInviteEmail` in routes/admin.ts, which deletes
 * the existing one first): admin-add has no separate "resend" mode.
 */
export async function addEndUser(email: string, name: string): Promise<{ alreadyInvited: boolean }> {
  const response = await fetch(adminAuthUrl('/users'), { method: 'POST', headers: adminAuthHeaders(), body: JSON.stringify({ email, name }) })
  if (response.status === 409) return { alreadyInvited: true }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Deploro end-user creation failed (${response.status}): ${body}`)
  }
  return { alreadyInvited: false }
}

export async function findEndUserByEmail(email: string): Promise<{ id: string } | null> {
  const response = await fetch(`${adminAuthUrl('/users')}?limit=1000`, { headers: adminAuthHeaders() })
  if (!response.ok) throw new Error(`Failed to list Deploro end users (${response.status})`)
  const body = (await response.json()) as { users: { id: string; email: string }[] }
  const match = body.users.find((u) => u.email.toLowerCase() === email.toLowerCase())
  return match ? { id: match.id } : null
}

export async function deleteEndUser(id: string): Promise<void> {
  const response = await fetch(adminAuthUrl(`/users/${id}`), { method: 'DELETE', headers: adminAuthHeaders() })
  if (!response.ok && response.status !== 404) {
    const body = await response.text().catch(() => '')
    throw new Error(`Failed to delete Deploro end user (${response.status}): ${body}`)
  }
}
