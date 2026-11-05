import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply } from '../index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(here, '.test-data-ci')
fs.rmSync(dataDir, { recursive: true, force: true })

const routes = []
const fakeSessions = {
  async prompt() {},
  async create() {
    return { sessionId: 'ci-session' }
  },
  async inspect() {
    return { events: [] }
  },
  async rename() {},
}
const ctx = {
  get: (name) => {
    if (name === 'sessionController') return fakeSessions
    if (name === 'tools') return { register: () => () => {} }
    if (name === 'llm') return { async *stream() {} }
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'mock', model: 'mock' }) }
    return undefined
  },
  effect: (fn) => fn(),
  webServer: {
    register: (route) => {
      routes.push(route)
      return () => {}
    },
  },
}

apply(ctx, { dataDir })

const server = http.createServer((req, res) => routes[0].handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

try {
  const pdf = fs.readFileSync(path.join(here, 'fixtures', 'smoke.pdf'))
  const upload = await fetch(`${origin}/paper-reflow/upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/pdf', 'x-file-name': 'smoke.pdf' },
    body: pdf,
  })
  assert.equal(upload.status, 201, 'upload should return 201')
  const uploaded = await upload.json()
  assert.ok(uploaded.paper && uploaded.paper.id, 'upload should return a paper')

  const pageResponse = await fetch(`${origin}/paper-reflow/paper/${uploaded.paper.id}/page/1`)
  assert.equal(pageResponse.status, 200, 'page should load')
  const page = await pageResponse.json()
  const text = page.blocks
    .filter((block) => block.kind === 'text')
    .map((block) => block.text)
    .join('\n')
  assert.match(text, /PaperFlow Smoke Test/, 'page text should contain the title')

  const library = await (await fetch(`${origin}/paper-reflow/library`)).json()
  assert.equal(library.papers.length, 1, 'library should have one paper')

  const noteResponse = await fetch(`${origin}/paper-reflow/paper/${uploaded.paper.id}/notes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ page: 1, quote: '', text: 'CI note' }),
  })
  assert.equal(noteResponse.status, 201, 'note should be created')
  const notes = await (await fetch(`${origin}/paper-reflow/paper/${uploaded.paper.id}/notes`)).json()
  assert.equal(notes.notes.length, 1, 'note should be listed')

  console.log('CI smoke test passed')
} finally {
  server.close()
}
