import { Router } from 'express'
import { createUser, getUserByEmail, getUserByUsername, listUsers } from '../db/users.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import type { UserRole } from '../db/types.js'

export const adminRouter = Router()

adminRouter.use(requireAuth, requireRole('admin'))

const INVITABLE_ROLES: UserRole[] = ['member', 'contributor']

adminRouter.get('/users', async (_req, res) => {
  const users = await listUsers()
  res.json({ users: users.map((u) => ({ id: u.id, username: u.username, email: u.email, role: u.role, createdAt: u.createdAt })) })
})

// Creates the app-level invite record only — no Deploro identity is
// created here. The invitee attaches their own password credential
// themselves via POST /auth/accept-invite; see routes/auth.ts for why that
// two-step split is correct rather than provisioning eagerly.
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
  res.status(201).json({ user: { id: user.id, username: user.username, email: user.email, role: user.role, createdAt: user.createdAt } })
})
