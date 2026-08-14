import { getRow, insertRow, listRows, updateRow } from './studioClient.js'
import type { VoiceRow } from './types.js'

const TABLE = 'voices'

function mapRow(row: Record<string, unknown>): VoiceRow {
  return {
    id: row.id as string,
    provider: row.provider as string,
    providerVoiceId: row.provider_voice_id as string,
    displayName: row.display_name as string,
  }
}

export async function listVoiceRows(): Promise<VoiceRow[]> {
  const rows = await listRows<Record<string, unknown>>(TABLE)
  return rows.map(mapRow).sort((a, b) => a.displayName.localeCompare(b.displayName))
}

export async function getVoice(id: string): Promise<VoiceRow | null> {
  const row = await getRow<Record<string, unknown>>(TABLE, id)
  return row ? mapRow(row) : null
}

/**
 * Upserts a voice by (provider, provider_voice_id) so re-syncing the
 * ElevenLabs voice list is idempotent. The Studio API has no native upsert
 * (no ON CONFLICT equivalent), so this does a filtered lookup first, then
 * either updates or inserts.
 */
export async function upsertVoice(input: {
  provider: string
  providerVoiceId: string
  displayName: string
}): Promise<VoiceRow> {
  const existing = await listRows<Record<string, unknown>>(TABLE, {
    filter: { provider: input.provider, provider_voice_id: input.providerVoiceId },
    limit: 1,
  })

  if (existing.length > 0) {
    const updated = await updateRow<Record<string, unknown>>(TABLE, existing[0].id as string, {
      display_name: input.displayName,
    })
    return mapRow(updated)
  }

  const row = await insertRow<Record<string, unknown>>(TABLE, {
    provider: input.provider,
    provider_voice_id: input.providerVoiceId,
    display_name: input.displayName,
  })
  return mapRow(row)
}
