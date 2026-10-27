import { randomUUID } from 'node:crypto'
import express, { Router, type NextFunction, type Request, type Response } from 'express'
import { requireAuth, requireRole } from '../middleware/auth.js'

/**
 * Deploro's shared VPS nginx (the one in front of every project's
 * {slug}.deploro.app) rejects any request body over 1MB with a 413, before
 * it ever reaches this stack — and that proxy is platform config, not ours.
 * So files are staged here in sub-1MB parts, then the normal import route
 * is called with `uploadId` in place of the file (see `acceptStagedUpload`).
 *
 * Staging is in memory: there is exactly one backend process, and an
 * abandoned upload only needs to outlive the few seconds between its last
 * part and the import call.
 */
export const UPLOAD_PART_SIZE = 512 * 1024
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const STAGED_UPLOAD_TTL_MS = 30 * 60 * 1000

interface StagedUpload {
  ownerId: string
  filename: string
  contentType: string
  size: number
  parts: Buffer[]
  createdAt: number
}

const stagedUploads = new Map<string, StagedUpload>()

function sweepExpired(): void {
  const cutoff = Date.now() - STAGED_UPLOAD_TTL_MS
  for (const [id, upload] of stagedUploads) {
    if (upload.createdAt < cutoff) stagedUploads.delete(id)
  }
}

function partCount(size: number): number {
  return Math.ceil(size / UPLOAD_PART_SIZE)
}

export const uploadsRouter = Router()

uploadsRouter.use(requireAuth, requireRole('admin', 'contributor'))

uploadsRouter.post('/', (req, res) => {
  const { filename, contentType, size } = req.body ?? {}
  if (typeof filename !== 'string' || !filename || typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
    res.status(400).json({ error: 'filename and size are required' })
    return
  }
  if (size > MAX_UPLOAD_BYTES) {
    res.status(413).json({ error: 'This file is too large to upload (50 MB max).' })
    return
  }

  sweepExpired()
  const uploadId = randomUUID()
  stagedUploads.set(uploadId, {
    ownerId: req.user!.id,
    filename,
    contentType: typeof contentType === 'string' && contentType ? contentType : 'application/octet-stream',
    size,
    parts: [],
    createdAt: Date.now(),
  })
  res.status(201).json({ uploadId, partSize: UPLOAD_PART_SIZE })
})

uploadsRouter.put('/:uploadId/parts/:index', express.raw({ type: () => true, limit: UPLOAD_PART_SIZE }), (req, res) => {
  const upload = stagedUploads.get(req.params.uploadId)
  if (!upload || upload.ownerId !== req.user!.id) {
    res.status(404).json({ error: 'Upload not found' })
    return
  }

  const index = Number(req.params.index)
  if (!Number.isInteger(index) || index < 0 || index >= partCount(upload.size) || !Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: 'Invalid part' })
    return
  }

  upload.parts[index] = req.body
  res.status(204).send()
})

/**
 * Runs after multer on an import route: when the request carries
 * `uploadId` instead of a file, assembles the staged parts into `req.file`
 * so the route handler can't tell the difference.
 */
export function acceptStagedUpload(maxBytes: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const uploadId = req.body?.uploadId
    if (req.file || typeof uploadId !== 'string') {
      next()
      return
    }

    const upload = stagedUploads.get(uploadId)
    if (!upload || upload.ownerId !== req.user!.id) {
      res.status(404).json({ error: 'Upload not found or expired. Please try again.' })
      return
    }
    if (upload.size > maxBytes) {
      stagedUploads.delete(uploadId)
      res.status(413).json({ error: 'This file is too large to upload.' })
      return
    }

    const expectedParts = partCount(upload.size)
    const buffer = Buffer.concat(upload.parts.slice(0, expectedParts).filter(Boolean))
    if (upload.parts.filter(Boolean).length !== expectedParts || buffer.length !== upload.size) {
      res.status(400).json({ error: 'Upload is incomplete. Please try again.' })
      return
    }

    stagedUploads.delete(uploadId)
    req.file = {
      fieldname: 'file',
      originalname: upload.filename,
      mimetype: upload.contentType,
      size: upload.size,
      buffer,
    } as Express.Multer.File
    next()
  }
}
