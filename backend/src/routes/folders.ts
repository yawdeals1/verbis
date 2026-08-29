import { Router } from 'express'
import { createFolder, deleteFolder, getFolder, listFoldersByOwner, renameFolder } from '../db/folders.js'
import { requireAuth } from '../middleware/auth.js'

export const foldersRouter = Router()

foldersRouter.use(requireAuth)

foldersRouter.get('/', async (req, res) => {
  const folders = await listFoldersByOwner(req.user!.id)
  res.json({ folders })
})

foldersRouter.post('/', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const folder = await createFolder(name, req.user!.id)
  res.status(201).json({ folder })
})

foldersRouter.patch('/:id', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const existing = await getFolder(req.params.id)
  if (!existing || existing.ownerId !== req.user!.id) {
    res.status(404).json({ error: 'Folder not found' })
    return
  }

  const folder = await renameFolder(req.params.id, name)
  res.json({ folder })
})

foldersRouter.delete('/:id', async (req, res) => {
  const existing = await getFolder(req.params.id)
  if (!existing || existing.ownerId !== req.user!.id) {
    res.status(404).json({ error: 'Folder not found' })
    return
  }

  await deleteFolder(req.params.id)
  res.status(204).send()
})
