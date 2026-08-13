import express from 'express'
import cors from 'cors'
import { env } from './config/env.js'
import { healthRouter } from './routes/health.js'
import { documentsRouter } from './routes/documents.js'

const app = express()

app.use(cors())
app.use(express.json())

app.use('/health', healthRouter)
app.use('/documents', documentsRouter)

app.listen(env.port, () => {
  console.log(`Verbis API listening on port ${env.port}`)
})
