import { readFileSync } from 'node:fs'
import { Router } from 'express'

export const healthRouter = Router()

healthRouter.get('/', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Temporary: /proc/meminfo inside a container reports the host's memory, which
// is the one number needed to tell a host OOM kill apart from an upstream bug
// as the reason the TTS container keeps dying mid-synthesis.
healthRouter.get('/host-memory', (_req, res) => {
  try {
    const wanted = new Set(['MemTotal', 'MemFree', 'MemAvailable', 'SwapTotal', 'SwapFree', 'Committed_AS'])
    const values = Object.fromEntries(
      readFileSync('/proc/meminfo', 'utf8')
        .split('\n')
        .map((line) => line.split(':'))
        .filter(([key]) => wanted.has(key))
        .map(([key, value]) => [key, value.trim()]),
    )
    res.json(values)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'unreadable' })
  }
})
