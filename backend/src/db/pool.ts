import { Pool } from 'pg'
import { env } from '../config/env.js'

let pool: Pool | undefined

// Lazy singleton so importing this module doesn't require DATABASE_URL
// to be set until a query actually runs.
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: env.databaseUrl })
  }
  return pool
}
