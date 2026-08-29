import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import { createUser, getUserByEmail, getUserById, getUserByUsername, listUsers } from '../db/users.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import * as deploroAuth from '../lib/deploroAuth.js'
import type { UserRole, UserRow } from '../db/types.js'

export const adminRouter = Router()

adminRouter.use(requireAuth, requireRole('admin'))

const INVITABLE_ROLES: UserRole[] = ['member', 'contributor']

function publicUser(u: UserRow) {
  return { id: u.id, username: u.username, email: u.email, role: u.role, createdAt: u.createdAt, pending: u.deploroUserId === null }
}

// Never shown to anyone, never stored — Deploro's email+password provider
// requires *some* password to create the identity, but the invitee always
// sets their own via "Forgot password" after clicking the confirmation
// email this triggers (see sendInviteEmail below for why that's the right
// primitive rather than a custom "set password" link, which Deploro's API
// has no way to generate).
function throwawayPassword(): string {
  return `${randomBytes(24).toString('base64url')}Aa1!`
}

/**
 * Triggers Deploro's own "Confirm your account" email by creating (or
 * re-creating, for a resend) the invitee's email+password identity with a
 * throwaway password. Once they click the confirmation link, their
 * identity is verified and "Forgot password" on the login page lets them
 * set a real one — verified live that re-calling signup on an unconfirmed
 * identity is safe (200 ok, fresh email) rather than erroring, which is
 * what makes this reusable for resends.
 */
async function sendInviteEmail(email: string, username: string): Promise<boolean> {
  try {
    await deploroAuth.signup(email, throwawayPassword(), username)
    return true
  } catch (err) {
    console.error(`Failed to send invite email to ${email}:`, err)
    return false
  }
}

adminRouter.get('/users', async (_req, res) => {
  const users = await listUsers()
  res.json({ users: users.map(publicUser) })
})

adminRouter.post('/invite', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : ''
  const role = req.body?.role as UserRole

  if (!email || !username) {
    res.status(400).json({ error: 'email and username are required' })
    return
  }
  if (!INVITABLE_ROLES.includes(role)) {
    res.status(400).json({ error: "role must be 'member' or 'contributor'" })
    return
  }
  if (!/^[a-z0-9_-]{3,32}$/i.test(username)) {
    res.status(400).json({ error: 'username must be 3-32 characters: letters, numbers, - or _' })
    return
  }

  if (await getUserByEmail(email)) {
    res.status(409).json({ error: 'That email is already invited or registered' })
    return
  }
  if (await getUserByUsername(username)) {
    res.status(409).json({ error: 'That username is already taken' })
    return
  }

  const user = await createUser({ username, email, role })
  const emailSent = await sendInviteEmail(email, username)
  res.status(201).json({ user: publicUser(user), emailSent })
})

adminRouter.post('/users/:id/resend-invite', async (req, res) => {
  const user = await getUserById(req.params.id)
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }
  if (user.deploroUserId) {
    res.status(400).json({ error: 'This account is already set up.' })
    return
  }

  const emailSent = await sendInviteEmail(user.email, user.username)
  if (!emailSent) {
    res.status(502).json({ error: 'Failed to send the invite email — try again.' })
    return
  }
  res.json({ ok: true })
})
