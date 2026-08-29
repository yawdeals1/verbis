import { getRow, insertRow, listRows, updateRow } from './studioClient.js'
import type { UserRole, UserRow } from './types.js'

const TABLE = 'users'

function mapRow(row: Record<string, unknown>): UserRow {
  return {
    id: row.id as string,
    deploroUserId: (row.deploro_user_id as string | null) ?? null,
    username: row.username as string,
    email: row.email as string,
    role: row.role as UserRole,
    createdAt: new Date(row.created_at as string).toISOString(),
  }
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const row = await getRow<Record<string, unknown>>(TABLE, id)
  return row ? mapRow(row) : null
}

// Emails are matched case-insensitively at the Deploro Auth-as-a-Service
// layer, so this looks up by lowercased email to match regardless of the
// casing a user typed at invite time vs. sign-in time.
export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const rows = await listRows<Record<string, unknown>>(TABLE, {
    filter: { email: email.toLowerCase() },
    limit: 1,
  })
  return rows.length > 0 ? mapRow(rows[0]) : null
}

export async function getUserByUsername(username: string): Promise<UserRow | null> {
  const rows = await listRows<Record<string, unknown>>(TABLE, {
    filter: { username },
    limit: 1,
  })
  return rows.length > 0 ? mapRow(rows[0]) : null
}

// deploroUserId is intentionally not accepted here — it's null until the
// invitee actually completes signup and logs in for the first time (see
// setDeploroUserId, called from routes/auth.ts's login handler).
export async function createUser(input: { username: string; email: string; role: UserRole }): Promise<UserRow> {
  const row = await insertRow<Record<string, unknown>>(TABLE, {
    deploro_user_id: null,
    username: input.username,
    email: input.email.toLowerCase(),
    role: input.role,
  })
  return mapRow(row)
}

export async function setDeploroUserId(id: string, deploroUserId: string): Promise<void> {
  await updateRow(TABLE, id, { deploro_user_id: deploroUserId })
}

export async function listUsers(): Promise<UserRow[]> {
  const rows = await listRows<Record<string, unknown>>(TABLE)
  return rows.map(mapRow).sort((a, b) => a.username.localeCompare(b.username))
}
