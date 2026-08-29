import type { UserRow } from '../db/types.js'

declare global {
  namespace Express {
    interface Request {
      user?: UserRow
    }
  }
}

export {}
