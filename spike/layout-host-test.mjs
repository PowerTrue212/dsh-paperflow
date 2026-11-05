import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply } from '../index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(here, '.test-layout-data')
fs.rmSync(dataDir, { recursive: true, force: true })

const routes = []
const fakeSessions = { async prompt() {}, async create() { return { sessionId: 's' } }, async inspect() {} }
const ctx = {
  get: (name) => {
    if (name === 'sessionController') return fakeSessions
    if (name === 'tools') return { register: () => () => {} }
    if (name === 'llm') return { async *stream() {} }
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'mock', model: 'mock' }) }
    return undefined
  },
  effect: (fn) => fn(),
  webServer: { register: (route) => { routes.push(route); return () => {} } },
}

apply(ctx, {
  dataDir,
  layout: {
    enabled: true,
    python: path.join(here, '..', '.venv-layout', 'Scripts', 'python.exe'),
    worker: path.join(here, '..', 'layout', 'worker.py'),
    model: 'PP-DocLayout-M',
  },
})

const server = http.createServer((req, res) => routes[0].handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

const pdf = fs.readFileSync(path.join(here, 'fixtures', 'resnet.pdf'))
const upload = await fetch(`${origin}/paper-reflow/upload`, {
  method: 'POST',
  headers: { 'content-type': 'application/pdf', 'x-file-name': 'resnet.pdf' },
  body: pdf,
})
const uploaded = await upload.json()
const page = await (await fetch(`${origin}/paper-reflow/paper/${uploaded.paper.id}/page/4`)).json()
const images = page.blocks.filter((block) => block.kind === 'image')
console.log('page 4 images', images.length, images.map((block) => `${block.role}:${block.bbox.map((v) => Math.round(v)).join(',')}`).join(' | '))
console.log('first text', (page.blocks.find((block) => block.kind === 'text') || {}).text?.slice(0, 40))
server.close()
