import { getPool } from './pool.js'
import type { VoiceRow } from './types.js'

function mapRow(row: Record<string, unknown>): VoiceRow {
  return {
    id: row.id as string,
    provider: row.provider as string,
    providerVoiceId: row.provider_voice_id as string,
    displayName: row.display_name as string,
  }
}

export async function listVoiceRows(): Promise<VoiceRow[]> {
  const { rows } = await getPool().query('SELECT * FROM voices ORDER BY display_name ASC')
  return rows.map(mapRow)
}

export async function getVoice(id: string): Promise<VoiceRow | null> {
  const { rows } = await getPool().query('SELECT * FROM voices WHERE id = $1', [id])
  return rows[0] ? mapRow(rows[0]) : null
}

/** Upserts a voice by (provider, provider_voice_id) so re-syncing the ElevenLabs voice list is idempotent. */
export async function upsertVoice(input: {
  provider: string
  providerVoiceId: string
  displayName: string
}): Promise<VoiceRow> {
  const { rows } = await getPool().query(
    `INSERT INTO voices (provider, provider_voice_id, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (provider, provider_voice_id) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING *`,
    [input.provider, input.providerVoiceId, input.displayName],
  )
  return mapRow(rows[0])
}
