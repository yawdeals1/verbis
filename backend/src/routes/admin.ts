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

/**
 * Triggers Deploro's own "Confirm your account" email via admin-add
 * (`deploroAuth.addEndUser` — see its doc comment for why this, not
 * `signup`, is what's safe to send here). admin-add 409s if an end user
 * already exists for this email, which is the normal case on every resend
 * — since it's a passwordless notification-only identity nothing of value
 * is lost by deleting and recreating it to force a fresh email, and this
 * function is only ever called for a user who hasn't finished real setup
 * yet (`deploroUserId` still null — enforced by the caller).
 */
async function sendInviteEmail(email: string, username: string): Promise<boolean> {
  try {
    const result = await deploroAuth.addEndUser(email, username)
    if (!result.alreadyInvited) return true

    const existing = await deploroAuth.findEndUserByEmail(email)
    if (existing) await deploroAuth.deleteEndUser(existing.id)
    const retry = await deploroAuth.addEndUser(email, username)
    return !retry.alreadyInvited
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
