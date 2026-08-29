import { Router } from 'express'
import { env } from '../config/env.js'
import * as deploroAuth from '../lib/deploroAuth.js'
import { getUserByEmail, setDeploroUserId } from '../db/users.js'
import { requireAuth, SESSION_COOKIE_NAME } from '../middleware/auth.js'
import type { UserRow } from '../db/types.js'

export const authRouter = Router()

const SESSION_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // matches Deploro's own session lifetime

function publicUser(user: UserRow) {
  return { id: user.id, username: user.username, email: user.email, role: user.role }
}

authRouter.post('/login', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' })
    return
  }

  let session: Awaited<ReturnType<typeof deploroAuth.login>>
  try {
    session = await deploroAuth.login(email, password)
  } catch (err) {
    if (err instanceof deploroAuth.DeploroAuthError) {
      res.status(401).json({ error: err.message })
      return
    }
    throw err
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    res.status(403).json({ error: "This account isn't invited to Verbis." })
    return
  }

  if (!user.deploroUserId) await setDeploroUserId(user.id, session.user.id)

  res.cookie(SESSION_COOKIE_NAME, session.token, {
    httpOnly: true,
    secure: env.sessionCookieSecure,
    sameSite: 'lax',
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
    path: '/',
  })
  res.json({ user: publicUser(user) })
})

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
  res.status(204).send()
})

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user!) })
})

// Reached from the /welcome page after clicking the admin-add notification
// email (see lib/deploroAuth.ts's addEndUser). The invitee's own chosen
// password goes straight into `signup` here — this is the only place a
// real password credential ever gets attached, deliberately never a
// throwaway one (see signup's doc comment for the incident that taught us
// why). Gated on a matching row already existing in Verbis's own `users`
// table (created only by an admin invite), not open signup.
authRouter.post('/accept-invite', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' })
    return
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' })
    return
  }

  const user = await getUserByEmail(email)
  if (!user) {
    res.status(400).json({ error: "This email hasn't been invited to Verbis." })
    return
  }
  if (user.deploroUserId) {
    res.status(400).json({ error: 'This account is already set up — log in instead.' })
    return
  }

  try {
    await deploroAuth.signup(email, password, user.username)
  } catch (err) {
    if (err instanceof deploroAuth.DeploroAuthError) {
      res.status(400).json({ error: err.message })
      return
    }
    throw err
  }

  res.json({ ok: true })
})

// NOTE: verified live that Deploro doesn't actually deliver a reset email
// for this project (see lib/deploroAuth.ts's requestPasswordReset) — kept
// as a correct client of Deploro's documented contract in case that gets
// fixed platform-side, but don't build anything new that depends on it
// working right now.
authRouter.post('/forgot-password', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : ''
  if (email) await deploroAuth.requestPasswordReset(email)
  // Always ok, whether or not the email is invited/known — don't leak which emails exist.
  res.json({ ok: true })
})

authRouter.post('/reset-password', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!token || !password) {
    res.status(400).json({ error: 'token and password are required' })
    return
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' })
    return
  }

  try {
    await deploroAuth.resetPassword(token, password)
  } catch (err) {
    if (err instanceof deploroAuth.DeploroAuthError) {
      res.status(400).json({ error: err.message })
      return
    }
    throw err
  }
  res.json({ ok: true })
})
