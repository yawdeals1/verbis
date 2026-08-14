import express from 'express'
import cors from 'cors'
import { env } from './config/env.js'
import { healthRouter } from './routes/health.js'
import { documentsRouter } from './routes/documents.js'
import { voicesRouter } from './routes/voices.js'

const app = express()

app.use(cors())
app.use(express.json())

app.use('/health', healthRouter)
app.use('/documents', documentsRouter)
app.use('/voices', voicesRouter)

// Catches errors thrown/rejected anywhere in the routers above (Express 5
// forwards rejected async handlers here automatically) so a missing
// secret or an unreachable provider returns a clean JSON error instead of
// leaking a stack trace to the client.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled request error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(env.port, () => {
  console.log(`Verbis API listening on port ${env.port}`)
})
