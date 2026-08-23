import { Router } from 'express'
import { listVoiceRows, upsertVoice } from '../db/voices.js'
import { activeProvider, listVoices as listProviderVoices } from '../services/tts.js'

export const voicesRouter = Router()

// Syncs from the active TTS provider into our `voices` table (so
// documents.voice_id has a stable FK target) and returns the current set.
// Cheap enough to call on every GET for a personal-use tool.
//
// Only the active provider's voices are returned: rows from a previously
// used backend stay in the table so existing documents keep resolving, but
// offering them for a new document would hand one provider's voice ID to
// another (see resolveVoice in services/documentPipeline.ts).
voicesRouter.get('/', async (_req, res) => {
  const provider = activeProvider()

  try {
    const remoteVoices = await listProviderVoices()
    await Promise.all(
      remoteVoices.map((v) =>
        upsertVoice({ provider, providerVoiceId: v.providerVoiceId, displayName: v.displayName }),
      ),
    )
  } catch (err) {
    console.error('Voice sync failed, returning cached voices:', err)
  }

  const voices = (await listVoiceRows()).filter((voice) => voice.provider === provider)
  res.json({ voices })
})
