import { Router } from 'express'
import { listVoiceRows, upsertVoice } from '../db/voices.js'
import { mapWithConcurrency } from '../lib/concurrency.js'
import { activeProvider, listVoices as listProviderVoices, type TtsProvider } from '../services/tts.js'
import { regionRank } from '../services/ttsTypes.js'
import type { VoiceRow } from '../db/types.js'

export const voicesRouter = Router()

// A first-ever sync of Speechify's ~700-voice catalog is all new rows, so
// the diffing below can't skip any of them — this caps how many upserts run
// at once so that cold start doesn't flood the Studio API with hundreds of
// simultaneous connections (see mapWithConcurrency).
const VOICE_SYNC_CONCURRENCY = 8

// A Studio API round trip for ~700 rows measured ~10s in practice — too
// slow to pay on every visit to the Import screen even when nothing
// changed. Short enough that a provider switch (which needs a process
// restart anyway, see env.ts) is never stale for long.
const RESPONSE_CACHE_TTL_MS = 10 * 60 * 1000
let responseCache: { provider: TtsProvider; voices: VoiceRow[]; fetchedAt: number } | null = null

// Syncs from the active TTS provider into our `voices` table (so
// documents.voice_id has a stable FK target) and returns the current set,
// American/British voices first (see regionRank).
//
// Only the active provider's voices are returned: rows from a previously
// used backend stay in the table so existing documents keep resolving, but
// offering them for a new document would hand one provider's voice ID to
// another (see resolveVoice in services/documentPipeline.ts).
voicesRouter.get('/', async (_req, res) => {
  const provider = activeProvider()

  if (responseCache && responseCache.provider === provider && Date.now() - responseCache.fetchedAt < RESPONSE_CACHE_TTL_MS) {
    res.json({ voices: responseCache.voices })
    return
  }

  try {
    const remoteVoices = await listProviderVoices()
    const existingByProviderVoiceId = new Map(
      (await listVoiceRows()).filter((v) => v.provider === provider).map((v) => [v.providerVoiceId, v]),
    )

    // Skip the write for voices already stored unchanged — Speechify's
    // catalog is ~700 voices, and re-upserting every one of them on every
    // request would be hundreds of Studio API round trips for no reason.
    const synced = await mapWithConcurrency(remoteVoices, VOICE_SYNC_CONCURRENCY, (v) => {
      const current = existingByProviderVoiceId.get(v.providerVoiceId)
      const unchanged =
        current &&
        current.displayName === v.displayName &&
        current.locale === (v.locale ?? null) &&
        current.previewAudioUrl === (v.previewAudioUrl ?? null)
      return unchanged
        ? Promise.resolve(current)
        : upsertVoice({
            provider,
            providerVoiceId: v.providerVoiceId,
            displayName: v.displayName,
            locale: v.locale ?? null,
            previewAudioUrl: v.previewAudioUrl ?? null,
          })
    })

    // listProviderVoices() already filters/orders — preserve that order
    // rather than re-deriving it.
    responseCache = { provider, voices: synced, fetchedAt: Date.now() }
    res.json({ voices: synced })
    return
  } catch (err) {
    console.error('Voice sync failed, returning cached voices:', err)
  }

  const cached = (await listVoiceRows())
    .filter((voice) => voice.provider === provider)
    .sort((a, b) => regionRank(a.locale) - regionRank(b.locale))
  res.json({ voices: cached })
})
