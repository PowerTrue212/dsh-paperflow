import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply } from '../index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(here, '.test-data')
fs.rmSync(dataDir, { recursive: true, force: true })

const routes = []
const toolDefs = []
let prompted = null
const fakeSessions = {
  async prompt(request) {
    prompted = request
  },
  async create() {
    return { sessionId: 'session-paper' }
  },
  async inspect() {
    return {
      events: [
        { type: 'user/message', data: { content: [{ type: 'text', text: '我的问题：这是什么？' }] } },
        { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '这是残差学习。' }] } } },
      ],
    }
  },
  async rename() {},
}
const fakeTools = {
  register: (definition) => {
    toolDefs.push(definition)
    return () => {}
  },
}
const fakeLlm = {
  async *stream(options) {
    const prompt = options.messages[0].content[0].text
    const payload = JSON.parse(prompt.split('\n').pop())
    if (prompt.includes('只做一件事')) {
      const items = payload.map((item, index) => ({
        id: item.id,
        text: `改写：${String(item.text).slice(0, 24)}${index === 0 ? ' $x^{2}$' : ''}`,
      }))
      yield { type: 'text-delta', index: 0, text: JSON.stringify({ items }) }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const returned = payload.length > 3 ? payload.slice(0, -1) : payload
    const translations = returned.map((item, index) => ({
      id: item.id,
      text: `译：${String(item.text).slice(0, 24)}${index === 0 ? ' $x^{2}$' : ''}`,
    }))
    yield { type: 'text-delta', index: 0, text: JSON.stringify({ translations }) }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}
const ctx = {
  get: (name) => {
    if (name === 'llm') return fakeLlm
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'mock', model: 'mock' }) }
    if (name === 'sessionController') return fakeSessions
    if (name === 'tools') return fakeTools
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

apply(ctx, { dataDir, vaultDir: path.join(here, '.test-vault') })

const server = http.createServer((req, res) => {
  routes[0].handler(req, res)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

const pdf = fs.readFileSync(path.join(here, 'fixtures', 'resnet.pdf'))
let response = await fetch(`${origin}/paper-reflow/upload`, {
  method: 'POST',
  headers: { 'content-type': 'application/pdf', 'x-file-name': encodeURIComponent('resnet.pdf') },
  body: pdf,
})
const uploaded = await response.json()
console.log('upload', response.status, uploaded.paper && uploaded.paper.title)
const paper = uploaded.paper

response = await fetch(`${origin}/paper-reflow/paper/${paper.id}/page/2?mode=auto`)
const second = await response.json()
console.log('page2', second.layout, second.blocks.length)

const blocks = second.blocks.filter((block) => block.kind !== 'image' && block.text).slice(0, 5)
response = await fetch(`${origin}/paper-reflow/translate`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ paperId: paper.id, page: 2, target: '简体中文', blocks }),
})
const translated = await response.json()
console.log('translate', response.status, translated.translated, JSON.stringify(translated.html || {}).includes('katex'))

const cachedTranslations = await (await fetch(`${origin}/paper-reflow/paper/${paper.id}/translations?page=2`)).json()
console.log('cached translations', Object.keys(cachedTranslations.translations || {}).length)

const image = second.blocks.find((block) => block.kind === 'image')
if (image) {
  const crop = await fetch(`${origin}/paper-reflow/paper/${paper.id}/figure/2.png?scale=2&box=${image.bbox.join(',')}`)
  console.log('crop', crop.status, (await crop.arrayBuffer()).byteLength)
}

const ask = await fetch(`${origin}/paper-reflow/ask`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sessionId: 'session-test', paperId: paper.id, page: 2, quote: 'residual learning', question: '这是什么？' }),
})
console.log('ask', ask.status, prompted && prompted.content[0].text.slice(0, 40))

await fetch(`${origin}/paper-reflow/activate`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sessionId: 'session-test', paperId: paper.id }),
})
const signal = new AbortController().signal
const readTool = toolDefs.find((definition) => definition.name === 'paper_read')
const readResult = await readTool.execute({ page: 2 }, { agent: { id: 'session-test' }, signal })
console.log('paper_read', readResult.text.slice(0, 60).replace(/\n/g, ' '))

const searchTool = toolDefs.find((definition) => definition.name === 'paper_search')
const searchResult = await searchTool.execute({ query: 'residual' }, { agent: { id: 'session-test' }, signal })
console.log('paper_search', searchResult.text.slice(0, 80).replace(/\n/g, ' '))

const noteResponse = await fetch(`${origin}/paper-reflow/paper/${paper.id}/notes`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ page: 2, quote: 'residual learning', text: '这个框架值得细看。' }),
})
console.log('note create', noteResponse.status)

const notesList = await (await fetch(`${origin}/paper-reflow/paper/${paper.id}/notes`)).json()
console.log('notes list', notesList.notes.length)

const exported = await (await fetch(`${origin}/paper-reflow/paper/${paper.id}/notes/export`, { method: 'POST' })).json()
console.log('export', exported.path)

const session = await (await fetch(`${origin}/paper-reflow/paper/${paper.id}/session`, { method: 'POST' })).json()
console.log('paper session', session.sessionId, session.created)

const qa = await fetch(`${origin}/paper-reflow/paper/${paper.id}/qa/export`, { method: 'POST' })
const qaValue = await qa.json()
console.log('qa export', qa.status, qaValue.path, qaValue.error || '')

const folder = await (
  await fetch(`${origin}/paper-reflow/library/folders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '测试文件夹' }),
  })
).json()
console.log('folder create', folder.folder && folder.folder.name)
await fetch(`${origin}/paper-reflow/paper/${paper.id}`, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ folderId: folder.folder.id }),
})
const library = await (await fetch(`${origin}/paper-reflow/library`)).json()
console.log('library folders', library.folders.length, 'paper folder', library.papers.find((item) => item.id === paper.id)?.folderId === folder.folder.id)

const formulas = await fetch(`${origin}/paper-reflow/paper/${paper.id}/formulas`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ page: 2, blocks: blocks.slice(0, 3) }),
})
const formulaValue = await formulas.json()
console.log('formulas', formulas.status, Object.keys(formulaValue.text || {}).length, JSON.stringify(formulaValue.html || {}).includes('katex'))

const added = await fetch(`${origin}/paper-reflow/add-url`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: 'https://arxiv.org/pdf/1512.03385' }),
})
const addedValue = await added.json()
console.log('add-url', added.status, addedValue.paper && addedValue.paper.kind)

const web = await fetch(`${origin}/paper-reflow/add-url`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: 'https://arxiv.org/html/1706.03762v7' }),
})
const webValue = await web.json()
console.log('add-url web', web.status, webValue.paper && webValue.paper.kind, webValue.paper && webValue.paper.pages, webValue.error || '')
if (webValue.paper && webValue.paper.kind === 'web') {
  const webPage = await (await fetch(`${origin}/paper-reflow/paper/${webValue.paper.id}/page/1`)).json()
  console.log('web page blocks', webPage.blocks && webPage.blocks.length, (webPage.blocks && webPage.blocks[1] && webPage.blocks[1].text.slice(0, 60)) || '')
}

server.close()
