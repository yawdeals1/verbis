import { Router } from 'express'
import { createFolder, deleteFolder, getFolder, listFolders, renameFolder } from '../db/folders.js'

export const foldersRouter = Router()

foldersRouter.get('/', async (_req, res) => {
  const folders = await listFolders()
  res.json({ folders })
})

foldersRouter.post('/', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const folder = await createFolder(name)
  res.status(201).json({ folder })
})

foldersRouter.patch('/:id', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const existing = await getFolder(req.params.id)
  if (!existing) {
    res.status(404).json({ error: 'Folder not found' })
    return
  }

  const folder = await renameFolder(req.params.id, name)
  res.json({ folder })
})

foldersRouter.delete('/:id', async (req, res) => {
  const existing = await getFolder(req.params.id)
  if (!existing) {
    res.status(404).json({ error: 'Folder not found' })
    return
  }

  await deleteFolder(req.params.id)
  res.status(204).send()
})
