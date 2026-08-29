import type { NextFunction, Request, Response } from 'express'
import { validateSession } from '../lib/deploroAuth.js'
import { getUserByEmail } from '../db/users.js'
import type { UserRole } from '../db/types.js'

const SESSION_COOKIE_NAME = 'verbis_session'

/**
 * Validates the `verbis_session` cookie against Deploro Auth-as-a-Service
 * (identity), then cross-references the resulting email against Verbis's
 * own `users` table (authorization). This second check is the actual
 * invite-only gate: Deploro alone can't refuse a stranger's raw signup, but
 * only the admin-invite flow ever inserts a row into `users`, so anyone not
 * invited 403s here regardless of having a valid Deploro identity.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE_NAME]
  if (!token) {
    res.status(401).json({ error: 'Not signed in' })
    return
  }

  const identity = await validateSession(token)
  if (!identity) {
    res.status(401).json({ error: 'Session expired' })
    return
  }

  const user = await getUserByEmail(identity.email)
  if (!user) {
    res.status(403).json({ error: 'This account is not invited to Verbis' })
    return
  }

  req.user = user
  next()
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Not permitted' })
      return
    }
    next()
  }
}

export { SESSION_COOKIE_NAME }
