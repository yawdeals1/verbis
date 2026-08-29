import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { env } from './config/env.js'
import { healthRouter } from './routes/health.js'
import { documentsRouter } from './routes/documents.js'
import { voicesRouter } from './routes/voices.js'
import { foldersRouter } from './routes/folders.js'
import { authRouter } from './routes/auth.js'
import { adminRouter } from './routes/admin.js'

const app = express()

// credentials: true + an explicit origin (not '*') is required for the
// verbis_session cookie to survive a cross-origin request — only matters
// in local dev, where Vite (5173) and the API (3001) are different
// origins; in production nginx proxies /api/* same-origin (see
// deploro.compose.yml) so this is moot there but harmless.
app.use(cors({ origin: env.frontendOrigin, credentials: true }))
app.use(express.json())
app.use(cookieParser())

app.use('/health', healthRouter)
app.use('/auth', authRouter)
app.use('/admin', adminRouter)
app.use('/documents', documentsRouter)
app.use('/voices', voicesRouter)
app.use('/folders', foldersRouter)

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
