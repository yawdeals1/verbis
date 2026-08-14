import { Router } from 'express'
import { listVoiceRows, upsertVoice } from '../db/voices.js'
import { listVoices as listElevenLabsVoices } from '../services/elevenlabs.js'

export const voicesRouter = Router()

// Syncs from ElevenLabs into our `voices` table (so documents.voice_id has a
// stable FK target) and returns the current set. Cheap enough to call on
// every GET for a personal-use, single-provider tool.
voicesRouter.get('/', async (_req, res) => {
  try {
    const remoteVoices = await listElevenLabsVoices()
    await Promise.all(
      remoteVoices.map((v) =>
        upsertVoice({ provider: 'elevenlabs', providerVoiceId: v.providerVoiceId, displayName: v.displayName }),
      ),
    )
  } catch (err) {
    console.error('Voice sync failed, returning cached voices:', err)
  }

  const voices = await listVoiceRows()
  res.json({ voices })
})
