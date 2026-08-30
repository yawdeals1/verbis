import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import path from 'node:path'
import { deleteDocument, getDocument, listDocumentsByOwner, updateLastPosition } from '../db/documents.js'
import { getFolder } from '../db/folders.js'
import { addDocumentToFolder, listAllDocumentFolders, listFolderIdsForDocument, removeDocumentFromFolder } from '../db/documentFolders.js'
import { getChunksForDocument } from '../db/chunks.js'
import { getVoice } from '../db/voices.js'
import { getUserById, getUserByUsername } from '../db/users.js'
import { findShare, listSharesForDocument, listSharesForUser, removeShare, shareDocument } from '../db/documentShares.js'
import { deleteObject, getObjectBuffer, putObject } from '../storage/index.js'
import { extractDocxText, extractEpubText, extractTxtText } from '../services/textExtraction.js'
import { ingestDocument, ingestPdfDocument, NoTextExtractedError } from '../services/documentPipeline.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { getAccessibleDocument, getOwnedDocument } from '../lib/documentAccess.js'
import { scanRouter } from './scan.js'
import { insightsRouter } from './insights.js'
import { urlImportRouter } from './urlImport.js'
import type { DocumentRow, SourceType } from '../db/types.js'

export const documentsRouter = Router()

documentsRouter.use(requireAuth)

documentsRouter.use('/scan', scanRouter)
documentsRouter.use('/url', urlImportRouter)
documentsRouter.use(insightsRouter)

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

// PDF is handled separately below (extractPdfLayout returns bounding-box
// data alongside text, which these plain extractors don't).
const EXTRACTORS: Partial<Record<SourceType, (buffer: Buffer) => Promise<string> | string>> = {
  docx: extractDocxText,
  txt: extractTxtText,
  epub: extractEpubText,
}

function sourceTypeFromFilename(filename: string): SourceType | null {
  const ext = path.extname(filename).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (ext === '.docx') return 'docx'
  if (ext === '.txt') return 'txt'
  if (ext === '.epub') return 'epub'
  return null
}

documentsRouter.post('/', requireRole('admin', 'contributor'), upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Missing file' })
    return
  }

  const sourceType = sourceTypeFromFilename(req.file.originalname)
  if (!sourceType) {
    res.status(400).json({ error: 'Unsupported file type. Use PDF, DOCX, TXT, or EPUB.' })
    return
  }

  if (sourceType !== 'pdf' && !EXTRACTORS[sourceType]) {
    res.status(400).json({ error: `No extractor registered for ${sourceType}` })
    return
  }

  try {
    const title = path.basename(req.file.originalname, path.extname(req.file.originalname))
    const ownerId = req.user!.id

    const document =
      sourceType === 'pdf'
        ? await ingestPdfDocument({
            title,
            fileBuffer: req.file.buffer,
            fileContentType: req.file.mimetype || 'application/octet-stream',
            ownerId,
            voiceId: typeof req.body.voiceId === 'string' ? req.body.voiceId : undefined,
          })
        : await ingestDocument({
            title,
            sourceType,
            fileBuffer: req.file.buffer,
            fileContentType: req.file.mimetype || 'application/octet-stream',
            extractedText: await EXTRACTORS[sourceType]!(req.file.buffer),
            ownerId,
            voiceId: typeof req.body.voiceId === 'string' ? req.body.voiceId : undefined,
          })

    res.status(201).json({ document })
  } catch (err) {
    if (err instanceof NoTextExtractedError) {
      res.status(422).json({ error: err.message })
      return
    }
    console.error('Document ingest failed:', err)
    res.status(500).json({ error: 'Failed to process document.' })
  }
})

documentsRouter.get('/', async (req, res) => {
  const user = req.user!
  const [owned, shares, folderMap] = await Promise.all([
    listDocumentsByOwner(user.id),
    listSharesForUser(user.id),
    listAllDocumentFolders(),
  ])

  const sharedDocs = (await Promise.all(shares.map((s) => getDocument(s.documentId)))).filter(
    (d): d is DocumentRow => d !== null,
  )

  const all = [...owned.map((d) => ({ doc: d, isOwner: true })), ...sharedDocs.map((d) => ({ doc: d, isOwner: false }))]

  // N+1, but this is a personal app with a handful of documents per user at
  // most — the Studio API has no aggregate/join query, so per-document
  // chunk counts (used to tell "first chunk ready" apart from "fully
  // generated" in the Library list) have to be fetched individually.
  const withChunkCounts = await Promise.all(
    all.map(async ({ doc, isOwner }) => {
      const chunks = await getChunksForDocument(doc.id)
      return {
        ...doc,
        isOwner,
        folderIds: isOwner ? (folderMap.get(doc.id) ?? []) : [],
        chunksTotal: chunks.length,
        chunksReady: chunks.filter((c) => c.status === 'ready').length,
        durationSeconds: chunks.reduce((sum, c) => sum + (c.durationSeconds ?? 0), 0),
      }
    }),
  )
  res.json({ documents: withChunkCounts })
})

documentsRouter.get('/:id', async (req, res) => {
  const document = await getAccessibleDocument(req.params.id, req.user!)
  if (!document) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  const isOwner = document.ownerId === req.user!.id
  const [chunks, voice, folderIds] = await Promise.all([
    getChunksForDocument(document.id),
    document.voiceId ? getVoice(document.voiceId) : Promise.resolve(null),
    isOwner ? listFolderIdsForDocument(document.id) : Promise.resolve([]),
  ])

  res.json({
    document: {
      ...document,
      isOwner,
      folderIds,
      chunksTotal: chunks.length,
      chunksReady: chunks.filter((c) => c.status === 'ready').length,
      durationSeconds: chunks.reduce((sum, c) => sum + (c.durationSeconds ?? 0), 0),
    },
    voice,
    chunks: chunks.map((chunk) => ({
      id: chunk.id,
      sequenceIndex: chunk.sequenceIndex,
      textContent: chunk.textContent,
      charStart: chunk.charStart,
      status: chunk.status,
      durationSeconds: chunk.durationSeconds,
      timingData: chunk.timingData,
      audioUrl: chunk.status === 'ready' ? `/documents/${document.id}/chunks/${chunk.sequenceIndex}/audio` : null,
    })),
  })
})

documentsRouter.get('/:id/original', async (req, res) => {
  const document = await getAccessibleDocument(req.params.id, req.user!)
  if (!document) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  try {
    const buffer = await getObjectBuffer(document.originalFileKey)
    res.setHeader('Content-Type', document.sourceType === 'pdf' ? 'application/pdf' : 'application/octet-stream')
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.send(buffer)
  } catch (err) {
    console.error('Failed to load original file:', err)
    res.status(500).json({ error: 'Failed to load original file' })
  }
})

/**
 * Serves an audio buffer with Range support — shared by the per-chunk and
 * merged-audio routes. <audio> elements need this to seek: without it, the
 * browser marks the resource as unseekable after its initial probe request
 * and silently drops any later `currentTime` assignment (tap-to-jump lands
 * back at 0 instead of the tapped word).
 */
function sendAudioBuffer(req: Request, res: Response, buffer: Buffer, cacheControl: string): void {
  res.setHeader('Content-Type', 'audio/mpeg')
  res.setHeader('Cache-Control', cacheControl)
  res.setHeader('Accept-Ranges', 'bytes')

  const range = req.headers.range
  if (!range) {
    res.setHeader('Content-Length', buffer.length)
    res.send(buffer)
    return
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  const start = match?.[1] ? Number(match[1]) : 0
  const end = match?.[2] ? Number(match[2]) : buffer.length - 1
  if (!match || start > end || end >= buffer.length) {
    res.status(416).setHeader('Content-Range', `bytes */${buffer.length}`).end()
    return
  }

  res.status(206)
  res.setHeader('Content-Range', `bytes ${start}-${end}/${buffer.length}`)
  res.setHeader('Content-Length', end - start + 1)
  res.send(buffer.subarray(start, end + 1))
}

documentsRouter.get('/:id/chunks/:sequenceIndex/audio', async (req, res) => {
  const document = await getAccessibleDocument(req.params.id, req.user!)
  if (!document) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  const chunks = await getChunksForDocument(document.id)
  const chunk = chunks.find((c) => c.sequenceIndex === Number(req.params.sequenceIndex))
  if (!chunk || chunk.status !== 'ready' || !chunk.audioKey) {
    res.status(404).json({ error: 'Chunk audio not ready' })
    return
  }

  try {
    const buffer = await getObjectBuffer(chunk.audioKey)
    // Immutable: a chunk's audio is never regenerated once ready
    // (CLAUDE.md — "cache aggressively").
    sendAudioBuffer(req, res, buffer, 'public, max-age=31536000, immutable')
  } catch (err) {
    console.error('Failed to load chunk audio:', err)
    res.status(500).json({ error: 'Failed to load audio' })
  }
})

function mergedAudioKeyFor(documentId: string): string {
  return `audio/${documentId}/merged.mp3`
}

/**
 * How much of the document's audio can be merged right now: generation runs
 * strictly in sequence (generateRemainingChunksInBackground in
 * services/generation.ts), so a chunk is never `ready` while an earlier one
 * is still `pending` — the first `pending` chunk is therefore the frontier,
 * and everything before it has been resolved one way or another. `error`
 * chunks don't stop the frontier; they're permanently skipped, same as
 * playableIndexFrom does for normal per-chunk playback.
 */
function resolvedChunkCount(chunks: { status: string }[]): number {
  const pendingIndex = chunks.findIndex((c) => c.status === 'pending')
  return pendingIndex === -1 ? chunks.length : pendingIndex
}

/**
 * Concatenates every *resolved* chunk's MP3 into one file, so playback can
 * cross section boundaries without the reload each chunk-swap otherwise
 * causes — without waiting for the whole document to finish generating
 * first. Re-running this later, once more chunks have resolved, produces a
 * longer file at the same key; useReaderPlayback.ts calls it again whenever
 * playback catches up to the end of what's currently merged, so the single
 * continuous player keeps extending itself as generation continues instead
 * of stopping there. `chunkCount` in the response tells the caller how many
 * chunks (from the front) the returned file now covers, and `complete`
 * says whether that's the whole document or there's still more coming.
 */
documentsRouter.post('/:id/merge', async (req, res) => {
  const document = await getAccessibleDocument(req.params.id, req.user!)
  if (!document) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  const chunks = await getChunksForDocument(document.id)
  const resolvedCount = resolvedChunkCount(chunks)
  const readyChunks = chunks.slice(0, resolvedCount).filter((c) => c.status === 'ready')

  if (readyChunks.length === 0) {
    res.status(409).json({ error: 'No sections are ready to merge yet.' })
    return
  }

  try {
    const buffers = await Promise.all(readyChunks.map((c) => getObjectBuffer(c.audioKey!)))
    await putObject(mergedAudioKeyFor(document.id), Buffer.concat(buffers), 'audio/mpeg')
    res.json({ merged: true, chunkCount: resolvedCount, complete: resolvedCount === chunks.length })
  } catch (err) {
    console.error('Failed to merge chunk audio:', err)
    res.status(500).json({ error: 'Failed to merge audio' })
  }
})

documentsRouter.get('/:id/merged-audio', async (req, res) => {
  const document = await getAccessibleDocument(req.params.id, req.user!)
  if (!document) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  try {
    const buffer = await getObjectBuffer(mergedAudioKeyFor(document.id))
    // Not immutable: unlike a chunk, this file grows in place at the same
    // key as more chunks resolve (see POST /merge above), so a cached copy
    // would go stale mid-read.
    sendAudioBuffer(req, res, buffer, 'no-store')
  } catch {
    res.status(404).json({ error: 'Merged audio not generated yet' })
  }
})

documentsRouter.delete('/:id', async (req, res) => {
  const document = await getOwnedDocument(req.params.id, req.user!)
  if (!document) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  const chunks = await getChunksForDocument(document.id)
  const audioKeys = chunks.map((c) => c.audioKey).filter((key): key is string => key !== null)

  // Best-effort: a storage object already missing (or a transient bucket
  // error) shouldn't block removing the document itself.
  await Promise.all(
    [document.originalFileKey, mergedAudioKeyFor(document.id), ...audioKeys].map((key) =>
      deleteObject(key).catch((err) => console.error(`Failed to delete storage object ${key}:`, err)),
    ),
  )

  await deleteDocument(document.id)
  res.status(204).send()
})

documentsRouter.post('/:id/folders/:folderId', async (req, res) => {
  const document = await getOwnedDocument(req.params.id, req.user!)
  if (!document) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  const folder = await getFolder(req.params.folderId)
  if (!folder || folder.ownerId !== req.user!.id) {
    res.status(404).json({ error: 'Folder not found' })
    return
  }

  await addDocumentToFolder(document.id, folder.id)
  res.status(204).send()
})

documentsRouter.delete('/:id/folders/:folderId', async (req, res) => {
  const document = await getOwnedDocument(req.params.id, req.user!)
  if (!document) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  await removeDocumentFromFolder(document.id, req.params.folderId)
  res.status(204).send()
})

documentsRouter.patch('/:id/position', async (req, res) => {
  const { chunkSequenceIndex, timeSeconds } = req.body ?? {}
  if (typeof chunkSequenceIndex !== 'number' || typeof timeSeconds !== 'number') {
    res.status(400).json({ error: 'chunkSequenceIndex and timeSeconds are required numbers' })
    return
  }

  // Position is stored on the document row itself, not per-user — so only
  // the owner's resume position is persisted. A shared recipient still gets
  // full playback, just without a saved resume point server-side.
  const document = await getOwnedDocument(req.params.id, req.user!)
  if (!document) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  await updateLastPosition(document.id, { chunkSequenceIndex, timeSeconds })
  res.status(204).send()
})

documentsRouter.get('/:id/shares', async (req, res) => {
  const document = await getOwnedDocument(req.params.id, req.user!)
  if (!document) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  const shares = await listSharesForDocument(document.id)
  const withUsernames = await Promise.all(
    shares.map(async (s) => ({ id: s.id, userId: s.sharedWithUserId, username: (await getUserById(s.sharedWithUserId))?.username })),
  )
  res.json({ shares: withUsernames })
})

documentsRouter.post('/:id/shares', async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : ''
  if (!username) {
    res.status(400).json({ error: 'username is required' })
    return
  }

  const document = await getOwnedDocument(req.params.id, req.user!)
  if (!document) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  const target = await getUserByUsername(username)
  if (!target) {
    res.status(404).json({ error: `No user with username "${username}"` })
    return
  }
  if (target.id === req.user!.id) {
    res.status(400).json({ error: "You already own this document." })
    return
  }
  if (await findShare(document.id, target.id)) {
    res.status(204).send()
    return
  }

  await shareDocument({ documentId: document.id, sharedByUserId: req.user!.id, sharedWithUserId: target.id })
  res.status(201).json({ userId: target.id, username: target.username })
})

documentsRouter.delete('/:id/shares/:userId', async (req, res) => {
  const document = await getOwnedDocument(req.params.id, req.user!)
  if (!document) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  const share = await findShare(document.id, req.params.userId)
  if (share) await removeShare(share.id)
  res.status(204).send()
})
