import { copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const assets = [['src/db/schema.sql', 'dist/db/schema.sql']]

for (const [from, to] of assets) {
  mkdirSync(path.dirname(to), { recursive: true })
  copyFileSync(from, to)
}
