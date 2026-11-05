/**
 * Host half of the Paper Reader bundle.
 *
 * Owns the local library, PDF parsing/reading-order reflow, and the HTTP
 * routes the right-sidebar reader calls. The native conversation is untouched;
 * chat integration arrives in a later phase.
 */
import crypto from 'node:crypto'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import katex from 'katex'

import { bestTitle, documentInfo, openDocument, reflowPage } from './engine.mjs'

const require = createRequire(import.meta.url)
let katexDist = ''
try {
  katexDist = path.join(path.dirname(require.resolve('katex/package.json')), 'dist')
} catch {
  katexDist = ''
}

const MAX_BYTES = 40 * 1024 * 1024
const MAX_PAGES = 250
const CACHE_VERSION = 10
const TRANSLATION_VERSION = 2
const ID_RE = /^[a-f0-9]{12}$/
const MODES = new Set(['auto', 'two', 'single'])

export const inject = ['webServer']

export function apply(ctx, config) {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const defaultBase = path.join(localAppData, 'dsh-paperflow')
  const legacyBases = [
    path.join(localAppData, 'dsh-paper-reader'),
    path.join(localAppData, 'dsh-paper-reflow'),
  ]
  if (!config?.dataDir) {
    for (const legacyBase of legacyBases) {
      if (fsSync.existsSync(defaultBase)) break
      if (!fsSync.existsSync(legacyBase)) continue
      try {
        fsSync.renameSync(legacyBase, defaultBase)
      } catch {
        /* keep using the legacy directory when it is locked */
      }
    }
  }
  const base = config?.dataDir
    ? path.resolve(String(config.dataDir))
    : fsSync.existsSync(defaultBase)
      ? defaultBase
      : legacyBases.find((item) => fsSync.existsSync(item)) || defaultBase
  const papersDir = path.join(base, 'papers')
  const indexPath = path.join(base, 'index.json')

  let indexPromise = null
  let indexWrite = Promise.resolve()
  const documents = new Map()
  const pageCaches = new Map()
  const translationCaches = new Map()
  const formulasCaches = new Map()
  const notesCaches = new Map()
  const webCaches = new Map()
  const activePapers = new Map()
  const lastAsks = new Map()

  const connection = ctx.get('connection')
  let canvasModule = null

  function guard(req, res) {
    // Resolve per request: the connection service may activate after this
    // plugin, and a value captured at apply time would silently disable auth.
    const current = connection || ctx.get('connection')
    if (!current?.requestRejection) return false
    const rejection = current.requestRejection(req)
    if (rejection === undefined) return false
    res.statusCode = rejection
    res.end()
    return true
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => {
      const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
      return map[character]
    })
  }

  function renderMathHtml(text) {
    if (!text) return ''
    const normalized = text
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, expression) => `$$${expression}$$`)
      .replace(/\\\(([\s\S]+?)\\\)/g, (_, expression) => `$${expression}$`)
    if (!normalized.includes('$')) return escapeHtml(normalized)
    let output = ''
    let index = 0
    const pattern = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g
    let match
    while ((match = pattern.exec(normalized))) {
      output += escapeHtml(normalized.slice(index, match.index))
      const expression = match[1] || match[2]
      const display = Boolean(match[1])
      try {
        output += katex.renderToString(expression, { displayMode: display, throwOnError: false, strict: 'ignore' })
      } catch {
        output += escapeHtml(match[0])
      }
      index = match.index + match[0].length
    }
    output += escapeHtml(normalized.slice(index))
    return output
  }

  async function handleVendor(res, sub) {
    if (!katexDist) return fail(res, 404, 'not found')
    const name = sub.slice('/vendor/'.length)
    if (name === 'katex.min.css') {
      try {
        const css = await fs.readFile(path.join(katexDist, 'katex.min.css'))
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/css; charset=utf-8')
        res.setHeader('Cache-Control', 'private, max-age=86400')
        res.end(css)
      } catch {
        fail(res, 404, 'not found')
      }
      return
    }
    const fontMatch = name.match(/^fonts\/([A-Za-z0-9_.-]+\.(?:woff2?|ttf))$/)
    if (fontMatch) {
      try {
        const font = await fs.readFile(path.join(katexDist, 'fonts', fontMatch[1]))
        res.statusCode = 200
        res.setHeader('Content-Type', fontMatch[1].endsWith('.woff2') ? 'font/woff2' : 'font/woff')
        res.setHeader('Cache-Control', 'private, max-age=86400')
        res.end(font)
      } catch {
        fail(res, 404, 'not found')
      }
      return
    }
    fail(res, 404, 'not found')
  }

  async function loadCanvas() {
    if (!canvasModule) {
      canvasModule = await import('@napi-rs/canvas')
      if (!globalThis.DOMMatrix) globalThis.DOMMatrix = canvasModule.DOMMatrix
      if (!globalThis.ImageData) globalThis.ImageData = canvasModule.ImageData
      if (!globalThis.Path2D) globalThis.Path2D = canvasModule.Path2D
    }
    return canvasModule
  }

  async function renderPage(doc, pageNumber, scale) {
    const { createCanvas } = await loadCanvas()
    const page = await doc.getPage(pageNumber)
    const viewport = page.getViewport({ scale })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: context, viewport }).promise
    return canvas
  }

  function send(res, status, value) {
    const body = JSON.stringify(value)
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(body)
  }

  function fail(res, status, message) {
    send(res, status, { error: message })
  }

  async function readBody(req, limit) {
    const chunks = []
    let total = 0
    for await (const chunk of req) {
      total += chunk.length
      if (total > limit) {
        const error = new Error('too large')
        error.code = 'TOO_LARGE'
        throw error
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }

  async function readJson(req, limit = 64 * 1024) {
    const raw = await readBody(req, limit)
    if (!raw.length) return {}
    try {
      return JSON.parse(raw.toString('utf8'))
    } catch {
      return {}
    }
  }

  async function ensureBase() {
    await fs.mkdir(papersDir, { recursive: true })
  }

  async function loadIndex() {
    if (indexPromise) return indexPromise
    indexPromise = (async () => {
      try {
        const parsed = JSON.parse(await fs.readFile(indexPath, 'utf8'))
        if (parsed && Array.isArray(parsed.papers)) {
          return { papers: parsed.papers, folders: Array.isArray(parsed.folders) ? parsed.folders : [] }
        }
      } catch {
        /* fresh library */
      }
      return { papers: [], folders: [] }
    })()
    return indexPromise
  }

  function saveIndex(index) {
    const snapshot = JSON.stringify(index, null, 1)
    indexWrite = indexWrite
      .then(async () => {
        await ensureBase()
        const tmp = `${indexPath}.tmp`
        await fs.writeFile(tmp, snapshot, 'utf8')
        await fs.rename(tmp, indexPath)
      })
      .catch(() => {})
    return indexWrite
  }

  function publicPaper(paper) {
    return {
      id: paper.id,
      title: paper.title,
      pages: paper.pages,
      kind: paper.kind || 'pdf',
      sourceUrl: paper.sourceUrl || '',
      addedAt: paper.addedAt,
      updatedAt: paper.updatedAt,
      lastPage: paper.lastPage || 1,
      view: paper.view || 'read',
      folderId: paper.folderId || null,
      sessionId: paper.sessionId || null,
    }
  }

  async function findPaper(id) {
    const index = await loadIndex()
    return index.papers.find((paper) => paper.id === id)
  }

  function paperFile(id) {
    return path.join(papersDir, id, 'source.pdf')
  }

  async function ensureDocument(id) {
    const cached = documents.get(id)
    if (cached) return cached
    const promise = openDocument(paperFile(id)).catch((error) => {
      documents.delete(id)
      throw error
    })
    documents.set(id, promise)
    return promise
  }

  async function pageCache(id) {
    const cached = pageCaches.get(id)
    if (cached) return cached
    const file = path.join(papersDir, id, 'pages.json')
    const entry = { data: { pages: {} }, writing: Promise.resolve() }
    entry.loaded = fs
      .readFile(file, 'utf8')
      .then((text) => {
        const parsed = JSON.parse(text)
        if (parsed && parsed.version === CACHE_VERSION && parsed.pages && typeof parsed.pages === 'object') {
          entry.data = { pages: parsed.pages }
        }
      })
      .catch(() => {})
    pageCaches.set(id, entry)
    await entry.loaded
    return entry
  }

  function persistPage(id, key, page) {
    const entry = pageCaches.get(id)
    if (!entry) return
    entry.data.pages[key] = page
    const snapshot = JSON.stringify({ version: CACHE_VERSION, pages: entry.data.pages })
    entry.writing = entry.writing
      .then(async () => {
        const tmp = path.join(papersDir, id, 'pages.json.tmp')
        await fs.writeFile(tmp, snapshot, 'utf8')
        await fs.rename(tmp, path.join(papersDir, id, 'pages.json'))
      })
      .catch(() => {})
  }

  function hashText(text) {
    return crypto.createHash('sha1').update(text).digest('hex').slice(0, 16)
  }

  async function translationCache(id) {
    const cached = translationCaches.get(id)
    if (cached) return cached
    const file = path.join(papersDir, id, 'translations.json')
    const entry = { data: { version: TRANSLATION_VERSION, items: {} }, writing: Promise.resolve() }
    entry.loaded = fs
      .readFile(file, 'utf8')
      .then((text) => {
        const parsed = JSON.parse(text)
        if (parsed && parsed.version === TRANSLATION_VERSION && parsed.items && typeof parsed.items === 'object') {
          entry.data = parsed
        }
      })
      .catch(() => {})
    translationCaches.set(id, entry)
    await entry.loaded
    return entry
  }

  function persistTranslations(id) {
    const entry = translationCaches.get(id)
    if (!entry) return
    const snapshot = JSON.stringify(entry.data)
    entry.writing = entry.writing
      .then(async () => {
        const tmp = path.join(papersDir, id, 'translations.json.tmp')
        await fs.writeFile(tmp, snapshot, 'utf8')
        await fs.rename(tmp, path.join(papersDir, id, 'translations.json'))
      })
      .catch(() => {})
  }

  async function formulasCache(id) {
    const cached = formulasCaches.get(id)
    if (cached) return cached
    const file = path.join(papersDir, id, 'formulas.json')
    const entry = { data: { version: 1, items: {} }, writing: Promise.resolve() }
    entry.loaded = fs
      .readFile(file, 'utf8')
      .then((text) => {
        const parsed = JSON.parse(text)
        if (parsed && parsed.items && typeof parsed.items === 'object') entry.data = parsed
      })
      .catch(() => {})
    formulasCaches.set(id, entry)
    await entry.loaded
    return entry
  }

  function persistFormulas(id) {
    const entry = formulasCaches.get(id)
    if (!entry) return
    const snapshot = JSON.stringify(entry.data)
    entry.writing = entry.writing
      .then(async () => {
        const tmp = path.join(papersDir, id, 'formulas.json.tmp')
        await fs.writeFile(tmp, snapshot, 'utf8')
        await fs.rename(tmp, path.join(papersDir, id, 'formulas.json'))
      })
      .catch(() => {})
  }

  async function rewriteFormulas(blocks) {
    const llm = ctx.get('llm')
    if (!llm || typeof llm.stream !== 'function') throw new Error('当前环境没有可用的模型服务。')
    const selection = ctx.get('agentDefaultModel')?.currentSelection?.() || {}
    const provider = selection.provider || 'deepseek-official'
    const model = selection.model || 'deepseek-chat'
    let reasoningEffort
    try {
      const info = await llm.resolveModelInfo?.(provider, model)
      const efforts = info?.reasoning?.efforts || []
      const low = efforts.find((effort) => /^(none|minimal|low)$/i.test(String(effort.id)))
      if (low) reasoningEffort = low.id
    } catch {
      /* optional */
    }
    const prompt = [
      '下面每段是学术论文原文。只做一件事：把其中的数学公式、变量、上下标、希腊字母和运算符改写成 LaTeX，并用 $...$ 包裹；其余文字逐字保留，不翻译、不改写、不解释。',
      '只输出 JSON：{"items":[{"id":"原 id","text":"改写后的整段"}]}，与输入一一对应。',
      JSON.stringify(blocks.map((block) => ({ id: block.id, text: block.text }))),
    ].join('\n')
    const chars = blocks.reduce((sum, block) => sum + block.text.length, 0)
    let output = ''
    for await (const chunk of llm.stream({
      provider,
      model,
      system: '你只输出要求的 JSON。',
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      temperature: 0,
      maxTokens: Math.max(4096, Math.min(16384, 1200 + chars * 2)),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      signal: AbortSignal.timeout(120_000),
    })) {
      if (chunk.type === 'text-delta') output += chunk.text
      else if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text' && !output) {
        output = chunk.block.text
      } else if (chunk.type === 'finish' && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted')) {
        throw new Error('模型调用失败。')
      }
    }
    const cleaned = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    let parsed
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      const start = cleaned.indexOf('{')
      const end = cleaned.lastIndexOf('}')
      if (start >= 0 && end > start) {
        try {
          parsed = JSON.parse(cleaned.slice(start, end + 1))
        } catch {
          parsed = undefined
        }
      }
    }
    if (!parsed) return {}
    const list = Array.isArray(parsed) ? parsed : parsed.items
    const known = new Set(blocks.map((block) => block.id))
    const result = {}
    if (Array.isArray(list)) {
      for (const item of list) {
        if (item && typeof item.id === 'string' && typeof item.text === 'string' && known.has(item.id) && item.text.trim()) {
          result[item.id] = item.text.trim()
        }
      }
    }
    return result
  }

  async function notesCache(id) {
    const cached = notesCaches.get(id)
    if (cached) return cached
    const file = path.join(papersDir, id, 'notes.json')
    const entry = { data: { version: 1, notes: [] }, writing: Promise.resolve() }
    entry.loaded = fs
      .readFile(file, 'utf8')
      .then((text) => {
        const parsed = JSON.parse(text)
        if (parsed && Array.isArray(parsed.notes)) entry.data = { version: 1, notes: parsed.notes }
      })
      .catch(() => {})
    notesCaches.set(id, entry)
    await entry.loaded
    return entry
  }

  function persistNotes(id) {
    const entry = notesCaches.get(id)
    if (!entry) return
    const snapshot = JSON.stringify(entry.data, null, 1)
    entry.writing = entry.writing
      .then(async () => {
        const tmp = path.join(papersDir, id, 'notes.json.tmp')
        await fs.writeFile(tmp, snapshot, 'utf8')
        await fs.rename(tmp, path.join(papersDir, id, 'notes.json'))
      })
      .catch(() => {})
  }

  function slugify(title) {
    return (
      String(title)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'paper'
    )
  }

  function noteMarkdown(paper, notes, date) {
    const lines = [
      '---',
      'author: self',
      `title: ${JSON.stringify(paper.title)}`,
      `paper: ${JSON.stringify(paper.title)}`,
      `source: ${paper.sourceUrl || 'local pdf'}`,
      `exported: ${date}`,
      '---',
      '',
      `# ${paper.title} 阅读批注`,
      '',
    ]
    for (const note of notes) {
      lines.push(`## 第 ${note.page} 页`, '')
      if (note.quote) lines.push(`> ${String(note.quote).replace(/\n/g, ' ')}`, '')
      lines.push(String(note.text || '').trim(), '')
    }
    return `${lines.join('\n')}\n`
  }

  async function writeNotesExport(paper, notes) {
    const vault = config?.vaultDir ? path.resolve(String(config.vaultDir)) : ''
    if (!vault) throw new Error('未配置知识库路径（vaultDir）。')
    const dir = path.join(vault, 'sources', 'self')
    await fs.mkdir(dir, { recursive: true })
    const date = new Date().toISOString().slice(0, 10)
    const base = path.join(dir, `${date}-${slugify(paper.title)}`)
    let file = paper.notesExportPath
    if (!file || !file.startsWith(dir + path.sep)) {
      file = `${base}.md`
      for (let index = 2; index < 1000; index++) {
        try {
          await fs.access(file)
          const head = (await fs.readFile(file, 'utf8')).slice(0, 40)
          if (head.startsWith('---\nauthor: self')) break
          file = `${base}-${index}.md`
        } catch {
          break
        }
      }
      paper.notesExportPath = file
    }
    const content = noteMarkdown(paper, notes.filter((note) => String(note.text || '').trim()), date)
    await fs.writeFile(file, content, 'utf8')
    return file
  }

  async function translateBlocks(blocks, target) {
    const llm = ctx.get('llm')
    if (!llm || typeof llm.stream !== 'function') throw new Error('当前环境没有可用的模型服务。')
    const selection = ctx.get('agentDefaultModel')?.currentSelection?.() || {}
    const provider = selection.provider || 'deepseek-official'
    const model = selection.model || 'deepseek-chat'
    let reasoningEffort
    try {
      const info = await llm.resolveModelInfo?.(provider, model)
      const efforts = info?.reasoning?.efforts || []
      const low =
        efforts.find((effort) => /^(none|minimal|low)$/i.test(String(effort.id))) ||
        efforts.find((effort) => /low|minimal/i.test(String(effort.name || '')))
      if (low) reasoningEffort = low.id
    } catch {
      /* model metadata is optional; omit the control when unavailable */
    }

    const collect = async (options) => {
      let output = ''
      let reasoning = ''
      let finish = ''
      let usage = null
      try {
        for await (const chunk of llm.stream(options)) {
          if (chunk.type === 'text-delta') output += chunk.text
          else if (chunk.type === 'reasoning-delta') reasoning += chunk.text
          else if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text' && !output) {
            output = chunk.block.text
          } else if (chunk.type === 'usage') {
            usage = chunk.usage
          } else if (chunk.type === 'finish' && chunk.reason) {
            finish = chunk.reason.kind || ''
            if (finish === 'error' || finish === 'aborted') {
              throw new Error(
                '模型调用失败：' +
                  (chunk.reason.failure && chunk.reason.failure.message ? chunk.reason.failure.message : finish),
              )
            }
          }
        }
      } catch (error) {
        if (error && error.name === 'AbortError') throw new Error('模型调用超时。')
        throw error
      }
      return { output, reasoning, finish, usage }
    }

    function parseTranslations(raw, subset) {
      const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
      let parsed
      try {
        parsed = JSON.parse(cleaned)
      } catch {
        const start = cleaned.indexOf('{')
        const end = cleaned.lastIndexOf('}')
        if (start >= 0 && end > start) {
          try {
            parsed = JSON.parse(cleaned.slice(start, end + 1))
          } catch {
            parsed = undefined
          }
        }
        if (parsed === undefined) {
          const arrayStart = cleaned.indexOf('[')
          const arrayEnd = cleaned.lastIndexOf(']')
          if (arrayStart >= 0 && arrayEnd > arrayStart) {
            try {
              parsed = JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1))
            } catch {
              parsed = undefined
            }
          }
        }
      }
      if (!parsed) return {}
      const known = new Set(subset.map((block) => block.id))
      const output = {}
      const list = Array.isArray(parsed) ? parsed : parsed.translations
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item && typeof item === 'object' && typeof item.id === 'string' && typeof item.text === 'string') {
            if (known.has(item.id) && item.text.trim()) output[item.id] = item.text.trim()
          }
        }
        if (!Object.keys(output).length && list.length === subset.length && list.every((item) => typeof item === 'string')) {
          subset.forEach((block, index) => {
            if (String(list[index] || '').trim()) output[block.id] = String(list[index]).trim()
          })
        }
      } else if (parsed && typeof parsed === 'object') {
        for (const block of subset) {
          if (typeof parsed[block.id] === 'string' && parsed[block.id].trim()) output[block.id] = parsed[block.id].trim()
        }
      }
      return output
    }

    async function attempt(subset) {
      const chars = subset.reduce((sum, block) => sum + block.text.length, 0)
      const prompt = [
        `把下面 JSON 数组中每个对象的 text 逐条翻译成${target}。`,
        '要求：保持术语、数字、引用标记与公式准确；不要解释、遗漏、合并或新增条目。',
        '数学要求（必须遵守）：原文里出现的任何公式、变量、上下标、希腊字母、运算符，都要改写成 LaTeX 并用 $...$ 包裹（行间公式用 $$...$$）；不要保留 Unicode 数学符号或 PDF 抽取出的乱码字形。',
        '示例：输入 text = "We minimize L(x)=||Ax-b||^2 over x." → 输出 text = "我们在 $x$ 上最小化 $L(x)=\\lVert Ax-b\\rVert^2$。"',
        '只输出 JSON：{"translations":[{"id":"原 id","text":"译文"}]}，与输入一一对应。',
        JSON.stringify(subset.map((block) => ({ id: block.id, text: block.text }))),
      ].join('\n')
      const base = {
        provider,
        model,
        system: '你是严谨的学术翻译，只输出要求的 JSON。',
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        temperature: 0,
      }
      let collected = await collect({
        ...base,
        maxTokens: Math.max(4096, Math.min(16384, 1200 + chars * 2)),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        signal: AbortSignal.timeout(120_000),
      })
      if (!collected.output.trim()) {
        // Reasoning models can spend the whole budget before emitting text.
        collected = await collect({ ...base, maxTokens: 8192, signal: AbortSignal.timeout(120_000) })
      }
      if (!collected.output.trim()) {
        const detail = [
          collected.finish ? `finish=${collected.finish}` : '',
          collected.usage ? `输出 ${collected.usage.outputTokens} tokens` : '',
          collected.reasoning ? `推理 ${collected.reasoning.length} 字` : '',
        ]
          .filter(Boolean)
          .join('，')
        throw new Error(`模型没有返回译文${detail ? `（${detail}）` : ''}。`)
      }
      return parseTranslations(collected.output, subset)
    }

    async function run(subset, depth) {
      if (!subset.length) return {}
      const result = await attempt(subset)
      const missing = subset.filter((block) => !result[block.id])
      if (!missing.length || subset.length === 1 || depth >= 4) return result
      const middle = Math.ceil(subset.length / 2)
      const left = await run(subset.slice(0, middle), depth + 1)
      const right = await run(subset.slice(middle), depth + 1)
      return { ...result, ...left, ...right }
    }

    const translations = await run(blocks, 0)
    if (!Object.keys(translations).length) throw new Error('模型返回的译文无法与原文对齐。')
    return translations
  }

  async function handle(req, res) {
    if (guard(req, res)) return
    const url = new URL(req.url || '/', 'http://paper-reflow.local')
    const sub = url.pathname.startsWith('/paper-reflow')
      ? url.pathname.slice('/paper-reflow'.length)
      : url.pathname

    if (sub === '/health') {
      send(res, 200, { ok: true, name: 'dsh-paperflow' })
      return
    }

    if (sub.startsWith('/vendor/')) {
      await handleVendor(res, sub)
      return
    }

    if (sub === '/library' && req.method === 'GET') {
      const index = await loadIndex()
      let changed = false
      for (const paper of index.papers) {
        if (paper.kind === 'web') continue
        if (!/^\d+[.\s]/.test(paper.title || '') && !/^(introduction|abstract|related work|method|experiments?|conclusion)$/i.test(paper.title || '')) continue
        try {
          const blocks = await pageBlocksFor(paper.id, paper, 1)
          const title = bestTitle(blocks)
          if (title && title !== paper.title) {
            paper.title = title
            changed = true
          }
        } catch {
          /* keep the stored title */
        }
      }
      if (changed) await saveIndex(index)
      const papers = index.papers
        .slice()
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .map(publicPaper)
      send(res, 200, { papers, folders: index.folders })
      return
    }

    if (sub === '/library/folders' && req.method === 'POST') {
      const body = await readJson(req, 64 * 1024)
      const name = String(body.name || '').trim().slice(0, 80)
      if (!name) return fail(res, 400, '请输入文件夹名称。')
      const index = await loadIndex()
      const folder = { id: crypto.randomUUID(), name, createdAt: Date.now() }
      index.folders.push(folder)
      await saveIndex(index)
      send(res, 201, { folder })
      return
    }

    const folderMatch = sub.match(/^\/library\/folders\/([A-Za-z0-9-]+)$/)
    if (folderMatch) {
      const index = await loadIndex()
      const folder = index.folders.find((item) => item.id === folderMatch[1])
      if (!folder) return fail(res, 404, '文件夹不存在。')
      if (req.method === 'PATCH') {
        const body = await readJson(req, 64 * 1024)
        const name = String(body.name || '').trim().slice(0, 80)
        if (!name) return fail(res, 400, '请输入文件夹名称。')
        folder.name = name
        await saveIndex(index)
        send(res, 200, { folder })
        return
      }
      if (req.method === 'DELETE') {
        index.folders = index.folders.filter((item) => item.id !== folder.id)
        for (const paper of index.papers) {
          if (paper.folderId === folder.id) paper.folderId = null
        }
        await saveIndex(index)
        send(res, 200, { ok: true })
        return
      }
      return fail(res, 405, '不支持这个操作。')
    }

    if (sub === '/upload' && req.method === 'POST') {
      await handleUpload(req, res)
      return
    }

    if (sub === '/add-url' && req.method === 'POST') {
      await handleAddUrl(req, res)
      return
    }

    const pageMatch = sub.match(/^\/paper\/([a-f0-9]{12})\/page\/(\d+)$/)
    if (pageMatch && req.method === 'GET') {
      await handlePage(res, pageMatch[1], Number(pageMatch[2]), url.searchParams.get('mode') || 'auto')
      return
    }

    const imageMatch = sub.match(/^\/paper\/([a-f0-9]{12})\/(figure|page-image)\/(\d+)\.png$/)
    if (imageMatch && req.method === 'GET') {
      await handleImage(res, imageMatch[1], imageMatch[2], Number(imageMatch[3]), url)
      return
    }

    const webImageMatch = sub.match(/^\/paper\/([a-f0-9]{12})\/web-image$/)
    if (webImageMatch && req.method === 'GET') {
      await handleWebImage(res, webImageMatch[1], url)
      return
    }

    const qaExportMatch = sub.match(/^\/paper\/([a-f0-9]{12})\/qa\/export$/)
    if (qaExportMatch && req.method === 'POST') {
      await handleQaExport(res, qaExportMatch[1])
      return
    }

    const translationMatch = sub.match(/^\/paper\/([a-f0-9]{12})\/translations$/)
    if (translationMatch && req.method === 'GET') {
      await handleTranslations(res, translationMatch[1], url)
      return
    }

    const formulasMatch = sub.match(/^\/paper\/([a-f0-9]{12})\/formulas$/)
    if (formulasMatch) {
      if (req.method === 'GET') {
        await handleFormulasGet(res, formulasMatch[1], url)
        return
      }
      if (req.method === 'POST') {
        await handleFormulasPost(req, res, formulasMatch[1])
        return
      }
    }

    if (sub === '/translate' && req.method === 'POST') {
      await handleTranslate(req, res)
      return
    }

    if (sub === '/ask' && req.method === 'POST') {
      await handleAsk(req, res)
      return
    }

    if (sub === '/activate' && req.method === 'POST') {
      const body = await readJson(req, 64 * 1024)
      const sessionId = String(body.sessionId || '').trim()
      const paperId = String(body.paperId || '').trim()
      if (!sessionId) return fail(res, 400, '没有会话。')
      if (!ID_RE.test(paperId)) return fail(res, 404, '找不到这篇文献。')
      const paper = await findPaper(paperId)
      if (!paper) return fail(res, 404, '找不到这篇文献。')
      activePapers.set(sessionId, paperId)
      send(res, 200, { ok: true })
      return
    }

    const paperSessionMatch = sub.match(/^\/paper\/([a-f0-9]{12})\/session$/)
    if (paperSessionMatch && req.method === 'POST') {
      await handlePaperSession(res, paperSessionMatch[1])
      return
    }

    const notesMatch = sub.match(/^\/paper\/([a-f0-9]{12})\/notes$/)
    if (notesMatch) {
      if (req.method === 'GET') {
        await handleNotesList(res, notesMatch[1])
        return
      }
      if (req.method === 'POST') {
        await handleNoteCreate(req, res, notesMatch[1])
        return
      }
    }

    const notesExportMatch = sub.match(/^\/paper\/([a-f0-9]{12})\/notes\/export$/)
    if (notesExportMatch && req.method === 'POST') {
      await handleNotesExport(res, notesExportMatch[1])
      return
    }

    const noteMatch = sub.match(/^\/paper\/([a-f0-9]{12})\/notes\/([A-Za-z0-9-]+)$/)
    if (noteMatch && req.method === 'DELETE') {
      await handleNoteDelete(res, noteMatch[1], noteMatch[2])
      return
    }

    const paperMatch = sub.match(/^\/paper\/([a-f0-9]{12})$/)
    if (paperMatch) {
      if (req.method === 'GET') {
        const paper = await findPaper(paperMatch[1])
        if (!paper) return fail(res, 404, '找不到这篇文献。')
        send(res, 200, { paper: publicPaper(paper) })
        return
      }
      if (req.method === 'PATCH') {
        const paper = await findPaper(paperMatch[1])
        if (!paper) return fail(res, 404, '找不到这篇文献。')
        const body = await readJson(req)
        if (typeof body.title === 'string' && body.title.trim()) paper.title = body.title.trim().slice(0, 200)
        if (Number.isInteger(body.lastPage) && body.lastPage > 0) paper.lastPage = Math.min(body.lastPage, paper.pages)
        if (typeof body.view === 'string' && body.view) paper.view = body.view
        if (body.folderId === null) paper.folderId = null
        else if (typeof body.folderId === 'string') {
          const index = await loadIndex()
          if (!index.folders.some((folder) => folder.id === body.folderId)) return fail(res, 400, '文件夹不存在。')
          paper.folderId = body.folderId
        }
        paper.updatedAt = Date.now()
        await saveIndex(await loadIndex())
        send(res, 200, { paper: publicPaper(paper) })
        return
      }
      if (req.method === 'DELETE') {
        const index = await loadIndex()
        const position = index.papers.findIndex((paper) => paper.id === paperMatch[1])
        if (position === -1) return fail(res, 404, '找不到这篇文献。')
        index.papers.splice(position, 1)
        documents.delete(paperMatch[1])
        pageCaches.delete(paperMatch[1])
        await saveIndex(index)
        await fs.rm(path.join(papersDir, paperMatch[1]), { recursive: true, force: true }).catch(() => {})
        send(res, 200, { ok: true })
        return
      }
      return fail(res, 405, '不支持这个操作。')
    }

    fail(res, 404, 'not found')
  }

  function httpError(status, message) {
    const error = new Error(message)
    error.status = status
    return error
  }

  async function ingestPdf(raw, name, sourceUrl = '') {
    if (!raw.length) throw httpError(400, '没有收到文件内容。')
    if (raw.subarray(0, 5).toString('latin1') !== '%PDF-') throw httpError(422, '请选择 PDF 文件。')
    const id = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12)
    const index = await loadIndex()
    const existing = index.papers.find((paper) => paper.id === id)
    if (existing) {
      if (/^[a-z0-9_-]{1,12}$/i.test(existing.title || '')) {
        try {
          const doc = await ensureDocument(existing.id)
          const first = await reflowPage(doc, 1, 'auto')
          const candidate = bestTitle(first.blocks)
          if (candidate && candidate.length > 3) existing.title = candidate
        } catch {
          /* keep the stored title */
        }
      }
      existing.updatedAt = Date.now()
      await saveIndex(index)
      return { paper: existing, reused: true }
    }

    const safeName =
      path.basename(name || 'document.pdf').replace(/[\\/:*?"<>|]/g, ' ').slice(0, 120) || 'document.pdf'
    const dir = path.join(papersDir, id)
    try {
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, 'source.pdf'), raw)
      const doc = await openDocument(path.join(dir, 'source.pdf'))
      const info = await documentInfo(doc, safeName.replace(/\.pdf$/i, ''))
      if (info.pages > MAX_PAGES) throw httpError(413, '目前最多支持 250 页。')
      let title = info.title
      try {
        const first = await reflowPage(doc, 1, 'auto')
        const candidate = bestTitle(first.blocks)
        if (candidate && candidate.length > 3 && candidate.length <= 200) title = candidate
      } catch {
        /* keep the metadata title */
      }
      const paper = {
        id,
        title,
        pages: info.pages,
        kind: 'pdf',
        sourceUrl,
        addedAt: Date.now(),
        updatedAt: Date.now(),
        lastPage: 1,
        view: 'read',
      }
      index.papers.unshift(paper)
      await saveIndex(index)
      return { paper, reused: false }
    } catch (error) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
      if (error.status) throw error
      console.error('[paper-reflow] ingest failed', error)
      throw httpError(422, '无法读取这个 PDF。')
    }
  }

  async function parseWebArticle(html, url) {
    const { load } = await import('cheerio')
    const $ = load(html)
    $('script,style,noscript,iframe,svg,form,button,nav,footer,header,aside,menu').remove()
    const metaTitle = ($('meta[property="og:title"]').attr('content') || '').trim()
    const title = (metaTitle || $('title').first().text().trim() || url).slice(0, 200)
    const candidates = ['article', 'main', '[role="main"]', '.post-content', '.article-content', '.entry-content', '#content']
    let root = null
    for (const selector of candidates) {
      const node = $(selector).first()
      if (node.length && node.text().trim().length > 300) {
        root = node
        break
      }
    }
    if (!root || !root.length) root = $('body')
    const blocks = []
    let counter = 0
    const push = (text, size, tag) => {
      const value = String(text).replace(/\s+/g, ' ').trim()
      if (value.length < 2) return
      if (blocks.length && blocks[blocks.length - 1].text === value) return
      blocks.push({
        id: `b${counter++}`,
        kind: 'text',
        text: value,
        column: 'full',
        size,
        tag,
        bbox: [40, 40 + counter * 18, 760, 40 + counter * 18 + 14],
      })
    }
    root.find('h1,h2,h3,h4,p,li,blockquote,pre,figcaption,img').each((_, element) => {
      const node = $(element)
      const tag = (element.tagName || '').toLowerCase()
      if (tag === 'img') {
        const source = node.attr('src') || node.attr('data-src') || ''
        if (!source) return
        let absolute
        try {
          absolute = new URL(source, url).toString()
        } catch {
          return
        }
        if (!/^https?:/i.test(absolute)) return
        const width = Number(node.attr('width') || 0)
        const height = Number(node.attr('height') || 0)
        if ((width && width < 60) || (height && height < 60)) return
        blocks.push({
          id: `b${counter++}`,
          kind: 'image',
          text: '',
          role: 'figure',
          src: absolute,
          column: 'full',
          size: 0,
          bbox: [40, 40 + counter * 18, 760, 40 + counter * 18 + 14],
        })
        return
      }
      const text = node.text()
      const sizes = { h1: 18, h2: 14, h3: 12, h4: 11, p: 10, li: 10, blockquote: 10, pre: 9, figcaption: 9 }
      push(tag === 'li' ? `• ${text}` : text, sizes[tag] || 10, tag)
    })
    if (!blocks.length) {
      const text = root.text().replace(/\s+/g, ' ').trim()
      if (text) push(text, 10, 'p')
    }
    const sections = []
    for (let start = 0; start < blocks.length; start += 60) {
      const slice = blocks.slice(start, start + 60)
      const heading = slice.find((block) => block.tag === 'h1' || block.tag === 'h2' || block.tag === 'h3')
      sections.push({ title: heading ? heading.text : '', blocks: slice })
    }
    return { title, sections }
  }

  async function saveWebPaper(url, parsed) {
    const id = crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)
    const index = await loadIndex()
    const existing = index.papers.find((paper) => paper.id === id)
    if (existing) {
      existing.updatedAt = Date.now()
      await saveIndex(index)
      return { paper: existing, reused: true }
    }
    const dir = path.join(papersDir, id)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, 'web.json'),
      JSON.stringify({ version: 1, title: parsed.title, url, sections: parsed.sections }),
      'utf8',
    )
    const paper = {
      id,
      title: parsed.title || url,
      pages: parsed.sections.length,
      kind: 'web',
      sourceUrl: url,
      addedAt: Date.now(),
      updatedAt: Date.now(),
      lastPage: 1,
      view: 'read',
    }
    index.papers.unshift(paper)
    await saveIndex(index)
    return { paper, reused: false }
  }

  async function loadWeb(id) {
    if (webCaches.has(id)) return webCaches.get(id)
    const promise = fs
      .readFile(path.join(papersDir, id, 'web.json'), 'utf8')
      .then((text) => JSON.parse(text))
      .catch(() => null)
    webCaches.set(id, promise)
    return promise
  }

  async function pageBlocksFor(id, paper, pageNumber) {
    if (paper.kind === 'web') {
      const web = await loadWeb(id)
      const section = web && Array.isArray(web.sections) ? web.sections[pageNumber - 1] : null
      return section && Array.isArray(section.blocks) ? section.blocks : []
    }
    const cache = await pageCache(id)
    let data = null
    for (const [key, value] of Object.entries(cache.data.pages)) {
      if (Number(key.split(':')[0]) === pageNumber && value && Array.isArray(value.blocks)) {
        data = value
        break
      }
    }
    if (!data) {
      const doc = await ensureDocument(id)
      data = await reflowPage(doc, pageNumber, 'auto')
      persistPage(id, `${pageNumber}:auto`, data)
    }
    return data.blocks || []
  }

  async function handleUpload(req, res) {
    let raw
    try {
      raw = await readBody(req, MAX_BYTES)
    } catch (error) {
      if (error.code === 'TOO_LARGE') return fail(res, 413, 'PDF 超过 40 MB。')
      throw error
    }
    const rawName = req.headers['x-file-name']
    let name = 'document.pdf'
    if (typeof rawName === 'string' && rawName.trim()) {
      try {
        name = decodeURIComponent(rawName)
      } catch {
        name = rawName
      }
    }
    try {
      const result = await ingestPdf(raw, name)
      send(res, result.reused ? 200 : 201, { paper: publicPaper(result.paper), reused: result.reused })
    } catch (error) {
      fail(res, error.status || 422, error.message || '无法读取这个 PDF。')
    }
  }

  async function handleAddUrl(req, res) {
    const body = await readJson(req)
    let url = String(body.url || '').trim()
    if (!/^https?:\/\//i.test(url)) return fail(res, 400, '请输入 http(s) 链接。')
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      return fail(res, 400, '链接格式不正确。')
    }
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(parsed.hostname)) {
      return fail(res, 400, '不能读取本机或内网地址。')
    }
    if (/(^|\.)arxiv\.org$/i.test(parsed.hostname) && parsed.pathname.startsWith('/abs/')) {
      parsed.pathname = parsed.pathname.replace('/abs/', '/pdf/')
      url = parsed.toString()
    }
    let response
    try {
      response = await fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 dsh-paperflow' },
        signal: AbortSignal.timeout(60_000),
      })
    } catch (error) {
      return fail(res, 502, '下载失败：' + (error instanceof Error ? error.message : '未知错误'))
    }
    if (!response.ok) return fail(res, 502, `下载失败（${response.status}）。`)
    let buffer
    try {
      buffer = Buffer.from(await response.arrayBuffer())
    } catch {
      return fail(res, 502, '读取下载内容失败。')
    }
    if (buffer.length > MAX_BYTES) return fail(res, 413, '内容超过 40 MB。')
    const contentType = response.headers.get('content-type') || ''
    const isPdf = contentType.includes('pdf') || buffer.subarray(0, 5).toString('latin1') === '%PDF-'
    if (!isPdf) {
      let parsedArticle
      try {
        parsedArticle = await parseWebArticle(buffer.toString('utf8'), response.url || url)
      } catch (error) {
        console.error('[paper-reflow] web parse failed', error)
        return fail(res, 502, '网页正文解析失败。')
      }
      if (!parsedArticle.sections.length) return fail(res, 422, '这个页面没有提取到可读正文。')
      try {
        const result = await saveWebPaper(response.url || url, parsedArticle)
        send(res, result.reused ? 200 : 201, { paper: publicPaper(result.paper), reused: result.reused })
      } catch (error) {
        console.error('[paper-reflow] web save failed', error)
        fail(res, 500, '保存网页失败。')
      }
      return
    }
    let name = 'paper.pdf'
    try {
      name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || 'paper.pdf')
    } catch {
      /* keep the default */
    }
    if (!name.toLowerCase().endsWith('.pdf')) name += '.pdf'
    try {
      const result = await ingestPdf(buffer, name, response.url || url)
      send(res, result.reused ? 200 : 201, { paper: publicPaper(result.paper), reused: result.reused })
    } catch (error) {
      fail(res, error.status || 422, error.message || '无法读取这个 PDF。')
    }
  }

  async function handlePage(res, id, number, mode) {
    if (!ID_RE.test(id)) return fail(res, 404, '找不到这篇文献。')
    if (!MODES.has(mode)) mode = 'auto'
    const paper = await findPaper(id)
    if (!paper) return fail(res, 404, '找不到这篇文献。')
    if (number < 1 || number > paper.pages) return fail(res, 404, '没有这一页。')

    if (paper.kind === 'web') {
      const web = await loadWeb(id)
      const section = web && Array.isArray(web.sections) ? web.sections[number - 1] : null
      if (!section) return fail(res, 404, '没有这一节。')
      send(res, 200, {
        page: number,
        width: 800,
        height: 1200,
        layout: 'single',
        detectedLayout: 'single',
        confidence: 1,
        blocks: section.blocks,
        title: section.title || '',
        sourceUrl: paper.sourceUrl || '',
      })
      return
    }

    const cache = await pageCache(id)
    const key = `${number}:${mode}`
    if (cache.data.pages[key]) {
      send(res, 200, cache.data.pages[key])
      return
    }
    try {
      const doc = await ensureDocument(id)
      const page = await reflowPage(doc, number, mode)
      persistPage(id, key, page)
      send(res, 200, page)
    } catch (error) {
      console.error('[paper-reflow] page failed', id, number, error)
      fail(res, 422, '这一页解析失败。')
    }
  }

  async function handleImage(res, id, kind, pageNumber, url) {
    if (!ID_RE.test(id)) return fail(res, 404, '找不到这篇文献。')
    const paper = await findPaper(id)
    if (!paper) return fail(res, 404, '找不到这篇文献。')
    if (pageNumber < 1 || pageNumber > paper.pages) return fail(res, 404, '没有这一页。')
    const scale = Math.min(3, Math.max(1, Number(url.searchParams.get('scale')) || 2))
    let canvas
    try {
      const doc = await ensureDocument(id)
      canvas = await renderPage(doc, pageNumber, scale)
    } catch (error) {
      console.error('[paper-reflow] render failed', id, pageNumber, error)
      return fail(res, 422, '这一页渲染失败。')
    }
    if (kind === 'figure') {
      const raw = (url.searchParams.get('box') || '').split(',').map(Number)
      if (raw.length !== 4 || raw.some((value) => !Number.isFinite(value))) return fail(res, 400, '图片区域无效。')
      const sx = Math.max(0, Math.floor(raw[0] * scale))
      const sy = Math.max(0, Math.floor(raw[1] * scale))
      const ex = Math.min(canvas.width, Math.ceil(raw[2] * scale))
      const ey = Math.min(canvas.height, Math.ceil(raw[3] * scale))
      if (ex - sx < 8 || ey - sy < 8) return fail(res, 400, '图片区域无效。')
      const { createCanvas } = await loadCanvas()
      const crop = createCanvas(ex - sx, ey - sy)
      crop.getContext('2d').drawImage(canvas, sx, sy, ex - sx, ey - sy, 0, 0, ex - sx, ey - sy)
      canvas = crop
    }
    try {
      const png = await canvas.encode('png')
      res.statusCode = 200
      res.setHeader('Content-Type', 'image/png')
      res.setHeader('Cache-Control', 'private, max-age=86400')
      res.end(png)
    } catch (error) {
      console.error('[paper-reflow] encode failed', error)
      fail(res, 500, '图片编码失败。')
    }
  }

  async function handleTranslations(res, id, url) {
    if (!ID_RE.test(id)) return fail(res, 404, '找不到这篇文献。')
    const paper = await findPaper(id)
    if (!paper) return fail(res, 404, '找不到这篇文献。')
    const page = Number(url.searchParams.get('page'))
    if (!Number.isInteger(page) || page < 1 || page > paper.pages) return fail(res, 400, '页码无效。')
    const target = (url.searchParams.get('target') || '简体中文').trim().slice(0, 40)
    const cache = await translationCache(id)
    const current = new Map()
    if (paper.kind === 'web') {
      const blocks = await pageBlocksFor(id, paper, page)
      for (const block of blocks) {
        if (block.kind === 'image' || !block.text) continue
        current.set(block.id, new Set([hashText(block.text)]))
      }
    } else {
      const pages = await pageCache(id)
      for (const [key, value] of Object.entries(pages.data.pages)) {
        const [keyPage] = key.split(':')
        if (Number(keyPage) !== page || !value || !Array.isArray(value.blocks)) continue
        for (const block of value.blocks) {
          if (block.kind === 'image' || !block.text) continue
          const hashes = current.get(block.id) || new Set()
          hashes.add(hashText(block.text))
          current.set(block.id, hashes)
        }
      }
    }
    const translations = {}
    for (const [key, value] of Object.entries(cache.data.items)) {
      const [keyPage, blockId] = key.split(':')
      if (Number(keyPage) !== page || value.target !== target) continue
      const hashes = current.get(blockId)
      if (!hashes || !hashes.has(value.hash)) continue
      translations[blockId] = value.text
    }
    const html = {}
    for (const [blockId, text] of Object.entries(translations)) html[blockId] = renderMathHtml(text)
    send(res, 200, { translations, html })
  }

  async function handleAsk(req, res) {
    const body = await readJson(req, 256 * 1024)
    const id = String(body.paperId || '')
    if (!ID_RE.test(id)) return fail(res, 404, '找不到这篇文献。')
    const paper = await findPaper(id)
    if (!paper) return fail(res, 404, '找不到这篇文献。')
    const page = Number(body.page)
    if (!Number.isInteger(page) || page < 1 || page > paper.pages) return fail(res, 400, '页码无效。')
    const sessionId = String(body.sessionId || '').trim()
    const question = String(body.question || '').trim().slice(0, 2000)
    const quote = String(body.quote || '').trim().slice(0, 2000)
    if (!sessionId) return fail(res, 400, '没有可用的会话。')
    if (!question) return fail(res, 400, '请输入问题。')

    const sessions = ctx.get('sessionController')
    if (!sessions || typeof sessions.prompt !== 'function') return fail(res, 503, '当前环境无法向会话发送消息。')

    let contextBlocks = []
    try {
      contextBlocks = await pageBlocksFor(id, paper, page)
    } catch {
      contextBlocks = []
    }
    const contextText = contextBlocks
      .filter((block) => block.kind !== 'image' && block.role !== 'meta' && block.text)
      .map((block) => block.text)
      .join('\n')
      .slice(0, 6000)

    const prompt = [
      `[论文阅读] 我正在阅读《${paper.title}》第 ${page} 页，阅读器在右侧栏。`,
      quote ? `我选中的原文：\n"""${quote}"""` : '',
      contextText ? `本页重排后的正文（供参考）：\n${contextText}` : '',
      `如果回答里引用页码，请写成 markdown 链接，例如：[第 ${page} 页](${jumpBase(paper.id)}${page})。用户点击链接会让阅读器跳到那一页。`,
      '需要更多上下文时可以调用 paper_read / paper_search 工具，它们作用于当前打开的论文。',
      `我的问题：${question}`,
    ]
      .filter(Boolean)
      .join('\n\n')

    try {
      await sessions.prompt(
        {
          sessionId,
          content: [{ type: 'text', text: prompt }],
          requestId: crypto.randomUUID(),
          mode: 'queue',
        },
        AbortSignal.timeout(15_000),
      )
      lastAsks.set(paper.id, { sessionId, question, quote, page, askedAt: Date.now() })
      send(res, 200, { ok: true })
    } catch (error) {
      console.error('[paper-reflow] ask failed', error)
      fail(res, 502, '发送到会话失败：' + (error instanceof Error ? error.message : '未知错误'))
    }
  }

  async function handlePaperSession(res, id) {
    if (!ID_RE.test(id)) return fail(res, 404, '找不到这篇文献。')
    const paper = await findPaper(id)
    if (!paper) return fail(res, 404, '找不到这篇文献。')
    const sessions = ctx.get('sessionController')
    if (!sessions || typeof sessions.create !== 'function') return fail(res, 503, '当前环境无法创建会话。')
    let sessionId = paper.sessionId
    if (sessionId) {
      try {
        await sessions.inspect(sessionId)
      } catch {
        sessionId = ''
      }
    }
    let created = false
    if (!sessionId) {
      const value = await sessions.create({})
      sessionId = value.sessionId
      created = true
      paper.sessionId = sessionId
      paper.updatedAt = Date.now()
      await saveIndex(await loadIndex())
      try {
        await sessions.rename({ sessionId, title: `论文：${paper.title}`.slice(0, 60) })
      } catch {
        /* rename is best effort */
      }
    }
    activePapers.set(sessionId, paper.id)
    send(res, 200, { sessionId, created })
  }

  async function handleNotesList(res, id) {
    if (!ID_RE.test(id)) return fail(res, 404, '找不到这篇文献。')
    const paper = await findPaper(id)
    if (!paper) return fail(res, 404, '找不到这篇文献。')
    const cache = await notesCache(id)
    send(res, 200, { notes: cache.data.notes.slice().sort((a, b) => (a.page || 0) - (b.page || 0)) })
  }

  async function handleNoteCreate(req, res, id) {
    if (!ID_RE.test(id)) return fail(res, 404, '找不到这篇文献。')
    const paper = await findPaper(id)
    if (!paper) return fail(res, 404, '找不到这篇文献。')
    const body = await readJson(req, 128 * 1024)
    const page = Number(body.page)
    const text = String(body.text || '').trim().slice(0, 8000)
    const quote = String(body.quote || '').trim().slice(0, 4000)
    if (!Number.isInteger(page) || page < 1 || page > paper.pages) return fail(res, 400, '页码无效。')
    if (!text) return fail(res, 400, '请写下你自己的判断或问题。')
    const cache = await notesCache(id)
    const note = { id: crypto.randomUUID(), page, quote, text, createdAt: Date.now() }
    cache.data.notes.push(note)
    persistNotes(id)
    let exportPath = ''
    try {
      exportPath = await writeNotesExport(paper, cache.data.notes)
      await saveIndex(await loadIndex())
    } catch (error) {
      console.error('[paper-reflow] auto export notes failed', error)
    }
    send(res, 201, { note, exportPath })
  }

  async function handleNoteDelete(res, id, noteId) {
    if (!ID_RE.test(id)) return fail(res, 404, '找不到这篇文献。')
    const paper = await findPaper(id)
    const cache = await notesCache(id)
    const before = cache.data.notes.length
    cache.data.notes = cache.data.notes.filter((note) => note.id !== noteId)
    if (cache.data.notes.length === before) return fail(res, 404, '找不到这条笔记。')
    persistNotes(id)
    if (paper && paper.notesExportPath && cache.data.notes.length) {
      try {
        await writeNotesExport(paper, cache.data.notes)
      } catch (error) {
        console.error('[paper-reflow] notes re-export failed', error)
      }
    }
    send(res, 200, { ok: true })
  }

  async function handleNotesExport(res, id) {
    if (!ID_RE.test(id)) return fail(res, 404, '找不到这篇文献。')
    const paper = await findPaper(id)
    if (!paper) return fail(res, 404, '找不到这篇文献。')
    const cache = await notesCache(id)
    const notes = cache.data.notes.filter((note) => String(note.text || '').trim())
    if (!notes.length) return fail(res, 400, '还没有可导出的笔记。')
    try {
      const file = await writeNotesExport(paper, notes)
      await saveIndex(await loadIndex())
      send(res, 200, { path: file, count: notes.length })
    } catch (error) {
      console.error('[paper-reflow] notes export failed', error)
      fail(res, 500, '写入知识库失败。')
    }
  }

  async function handleFormulasGet(res, id, url) {
    if (!ID_RE.test(id)) return fail(res, 404, '找不到这篇文献。')
    const paper = await findPaper(id)
    if (!paper) return fail(res, 404, '找不到这篇文献。')
    const page = Number(url.searchParams.get('page'))
    if (!Number.isInteger(page) || page < 1 || page > paper.pages) return fail(res, 400, '页码无效。')
    const cache = await formulasCache(id)
    const blocks = await pageBlocksFor(id, paper, page)
    const hashes = new Map(
      blocks.filter((block) => block.kind !== 'image' && block.text).map((block) => [block.id, hashText(block.text)]),
    )
    const text = {}
    for (const [key, value] of Object.entries(cache.data.items)) {
      const [keyPage, blockId] = key.split(':')
      if (Number(keyPage) !== page) continue
      if (hashes.get(blockId) !== value.hash) continue
      text[blockId] = value.text
    }
    const html = {}
    for (const [blockId, value] of Object.entries(text)) html[blockId] = renderMathHtml(value)
    send(res, 200, { text, html })
  }

  async function handleFormulasPost(req, res, id) {
    if (!ID_RE.test(id)) return fail(res, 404, '找不到这篇文献。')
    const paper = await findPaper(id)
    if (!paper) return fail(res, 404, '找不到这篇文献。')
    const body = await readJson(req)
    const page = Number(body.page)
    if (!Number.isInteger(page) || page < 1 || page > paper.pages) return fail(res, 400, '页码无效。')
    const blocks = Array.isArray(body.blocks)
      ? body.blocks
          .filter((block) => block && typeof block.id === 'string' && typeof block.text === 'string' && block.text.trim())
          .slice(0, 16)
      : []
    if (!blocks.length) return fail(res, 400, '没有要处理的段落。')
    const cache = await formulasCache(id)
    const text = {}
    const pending = []
    for (const block of blocks) {
      const key = `${page}:${block.id}`
      const hash = hashText(block.text)
      const hit = cache.data.items[key]
      if (hit && hit.hash === hash) text[block.id] = hit.text
      else pending.push({ block, key, hash })
    }
    if (pending.length) {
      try {
        const rewritten = await rewriteFormulas(pending.map((entry) => entry.block))
        pending.forEach((entry) => {
          const value = rewritten[entry.block.id]
          if (!value) return
          text[entry.block.id] = value
          cache.data.items[entry.key] = { text: value, hash: entry.hash, updatedAt: Date.now() }
        })
        persistFormulas(id)
      } catch (error) {
        console.error('[paper-reflow] formula rewrite failed', error)
        return fail(res, 502, '公式改写失败：' + (error instanceof Error ? error.message : '未知错误'))
      }
    }
    const html = {}
    for (const [blockId, value] of Object.entries(text)) html[blockId] = renderMathHtml(value)
    send(res, 200, { text, html })
  }

  async function handleTranslate(req, res) {
    const body = await readJson(req, 256 * 1024)
    const id = String(body.paperId || '')
    if (!ID_RE.test(id)) return fail(res, 404, '找不到这篇文献。')
    const paper = await findPaper(id)
    if (!paper) return fail(res, 404, '找不到这篇文献。')
    const page = Number(body.page)
    if (!Number.isInteger(page) || page < 1 || page > paper.pages) return fail(res, 400, '页码无效。')
    const target = String(body.target || '简体中文').trim().slice(0, 40) || '简体中文'
    const blocks = Array.isArray(body.blocks)
      ? body.blocks
          .filter((block) => block && typeof block.id === 'string' && typeof block.text === 'string' && block.text.trim())
          .slice(0, 16)
      : []
    if (!blocks.length) return fail(res, 400, '没有要翻译的段落。')
    if (blocks.some((block) => block.text.length > 6000)) return fail(res, 413, '段落过长。')

    const cache = await translationCache(id)
    const translations = {}
    const pending = []
    for (const block of blocks) {
      const key = `${page}:${block.id}`
      const hash = hashText(block.text)
      const hit = cache.data.items[key]
      if (hit && hit.hash === hash && hit.target === target) translations[block.id] = hit.text
      else pending.push({ block, key, hash })
    }

    let translated = 0
    if (pending.length) {
      try {
        const values = await translateBlocks(pending.map((entry) => entry.block), target)
        pending.forEach((entry) => {
          const text = values[entry.block.id]
          if (!text) return
          translations[entry.block.id] = text
          cache.data.items[entry.key] = { text, hash: entry.hash, target, updatedAt: Date.now() }
          translated += 1
        })
        persistTranslations(id)
      } catch (error) {
        console.error('[paper-reflow] translate failed', error)
        return fail(res, 502, '翻译失败：' + (error instanceof Error ? error.message : '未知错误'))
      }
    }
    const html = {}
    for (const [blockId, text] of Object.entries(translations)) html[blockId] = renderMathHtml(text)
    send(res, 200, { translations, html, translated, cached: blocks.length - pending.length })
  }

  function isPrivateHost(hostname) {
    return /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(String(hostname || ''))
  }

  async function handleWebImage(res, id, url) {
    if (!ID_RE.test(id)) return fail(res, 404, '找不到这篇文献。')
    const paper = await findPaper(id)
    if (!paper) return fail(res, 404, '找不到这篇文献。')
    const source = url.searchParams.get('src') || ''
    let parsed
    try {
      parsed = new URL(source)
    } catch {
      return fail(res, 400, '图片地址无效。')
    }
    if (!/^https?:$/.test(parsed.protocol)) return fail(res, 400, '图片地址无效。')
    if (isPrivateHost(parsed.hostname)) return fail(res, 400, '不能读取内网地址。')
    let response
    try {
      response = await fetch(source, {
        redirect: 'follow',
        headers: {
          'user-agent': 'Mozilla/5.0 dsh-paperflow',
          ...(paper.sourceUrl ? { referer: paper.sourceUrl } : {}),
        },
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      return fail(res, 502, '图片下载失败。')
    }
    if (!response.ok) return fail(res, 404, '图片不存在。')
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) return fail(res, 415, '这个地址不是图片。')
    let buffer
    try {
      buffer = Buffer.from(await response.arrayBuffer())
    } catch {
      return fail(res, 502, '读取图片失败。')
    }
    if (buffer.length > 10 * 1024 * 1024) return fail(res, 413, '图片过大。')
    res.statusCode = 200
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.end(buffer)
  }

  function contentText(content) {
    if (Array.isArray(content)) {
      return content
        .filter((block) => block && block.type === 'text')
        .map((block) => block.text)
        .join('\n')
    }
    return typeof content === 'string' ? content : ''
  }

  async function handleQaExport(res, id) {
    if (!ID_RE.test(id)) return fail(res, 404, '找不到这篇文献。')
    const paper = await findPaper(id)
    if (!paper) return fail(res, 404, '找不到这篇文献。')
    const ask = lastAsks.get(id)
    if (!ask) return fail(res, 400, '这个会话里还没有提问记录。')
    const sessions = ctx.get('sessionController')
    if (!sessions || typeof sessions.inspect !== 'function') return fail(res, 503, '当前环境无法读取会话。')
    let inspection
    try {
      inspection = await sessions.inspect(ask.sessionId)
    } catch (error) {
      console.error('[paper-reflow] qa inspect failed', error)
      return fail(res, 502, '读取会话失败。')
    }
    const events = Array.isArray(inspection && inspection.events)
      ? inspection.events
      : Array.isArray(inspection && inspection.eventPrefix)
        ? inspection.eventPrefix
        : []
    let sawAsk = false
    let answer = ''
    for (const event of events) {
      const type = event && event.type
      const data = (event && (event.data || event.payload)) || {}
      if (type === 'user/message') {
        const text = contentText(data.content)
        if (text.includes(ask.question)) {
          sawAsk = true
          answer = ''
        }
      } else if (type === 'assistant/message' && sawAsk) {
        const text = contentText(data.message ? data.message.content : data.content)
        if (text.trim()) answer = text
      }
    }
    if (!answer.trim()) return fail(res, 409, '会话里还没有这条问题的回答，等回答完成后再试。')
    const vault = config?.vaultDir ? path.resolve(String(config.vaultDir)) : ''
    if (!vault) return fail(res, 400, '未配置知识库路径（vaultDir），请在插件设置里填写。')
    const dir = path.join(vault, 'sources', 'ai')
    try {
      await fs.mkdir(dir, { recursive: true })
    } catch {
      return fail(res, 500, '无法创建 sources/ai 目录。')
    }
    const date = new Date().toISOString().slice(0, 10)
    const base = `${date}-${slugify(paper.title)}-qa`
    let file = path.join(dir, `${base}.md`)
    for (let index = 2; index < 1000; index++) {
      try {
        await fs.access(file)
        file = path.join(dir, `${base}-${index}.md`)
      } catch {
        break
      }
    }
    const markdown = [
      '---',
      'author: ai',
      `title: ${JSON.stringify(`${paper.title} · 问答`)}`,
      `paper: ${JSON.stringify(paper.title)}`,
      `page: ${ask.page}`,
      `asked: ${new Date(ask.askedAt).toISOString()}`,
      '---',
      '',
      `# ${paper.title} · 问答`,
      '',
      `**我问**（第 ${ask.page} 页）：`,
      ask.quote ? `> ${String(ask.quote).replace(/\n/g, ' ')}` : '',
      '',
      ask.question,
      '',
      '**AI 回答**：',
      '',
      answer.trim(),
      '',
      '---',
      '',
      '> 由 DSH「论文阅读」从会话记录导出；AI 生成内容，未经人工整理。',
      '',
    ].join('\n')
    try {
      await fs.writeFile(file, markdown, 'utf8')
    } catch (error) {
      console.error('[paper-reflow] qa export failed', error)
      return fail(res, 500, '写入知识库失败。')
    }
    send(res, 200, { path: file })
  }

  function jumpBase(paperId) {
    let origin = 'http://127.0.0.1'
    try {
      origin = ctx.get('webServer')?.getOrigin?.() || origin
    } catch {
      /* keep the loopback default */
    }
    return `${origin}/paper-reflow/jump?paper=${paperId}&page=`
  }

  async function pageText(id, paper, pageNumber) {
    const blocks = await pageBlocksFor(id, paper, pageNumber)
    return blocks
      .filter((block) => block.kind !== 'image' && block.role !== 'meta' && block.text)
      .map((block) => block.text)
      .join('\n')
  }

  const textOutput = {
    schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: String((value && value.text) || '') }],
  }

  const tools = ctx.get('tools')
  if (tools && typeof tools.register === 'function') {
    ctx.effect(() =>
      tools.register({
        name: 'paper_read',
        description:
          '读取右侧「论文阅读」阅读器里当前打开的论文。用 page 指定页码，或用 pages 指定 "3-5"/"3,5" 这样的范围；不传则读第 1 页。最多 5 页。',
        parameters: {
          type: 'object',
          properties: {
            page: { type: 'integer', description: '页码，从 1 开始' },
            pages: { type: 'string', description: '页码范围，如 3-5 或 3,5' },
          },
          additionalProperties: false,
        },
        output: textOutput,
        async execute(args, exec) {
          const paperId = activePapers.get(String(exec.agent && exec.agent.id))
          if (!paperId) return { text: '当前会话没有打开的论文。请先在右侧栏「论文阅读」里打开一篇。' }
          const paper = await findPaper(paperId)
          if (!paper) return { text: '这篇论文已不在文献库中。' }
          const pages = []
          if (args && Number.isInteger(args.page)) pages.push(args.page)
          else if (args && typeof args.pages === 'string') {
            for (const part of args.pages.split(',')) {
              const range = part.trim().split('-').map(Number)
              if (range.length === 2 && range.every(Number.isInteger)) {
                for (let value = range[0]; value <= range[1]; value++) pages.push(value)
              } else if (Number.isInteger(range[0])) {
                pages.push(range[0])
              }
            }
          }
          if (!pages.length) pages.push(1)
          const selected = pages.filter((value) => value >= 1 && value <= paper.pages).slice(0, 5)
          if (!selected.length) return { text: `页码超出范围（这篇论文共 ${paper.pages} 页）。` }
          const chunks = []
          for (const page of selected) {
            const text = await pageText(paper.id, paper, page)
            chunks.push(`第 ${page} 页：\n${text}`)
          }
          return {
            text: `《${paper.title}》（共 ${paper.pages} 页）\n\n${chunks.join('\n\n')}\n\n跳页链接基址：${jumpBase(paper.id)}<页码>`,
          }
        },
      }),
    )

    ctx.effect(() =>
      tools.register({
        name: 'paper_search',
        description: '在右侧阅读器当前打开的论文全文里搜索关键词，返回命中页码与上下文片段。先用它定位，再用 paper_read 读整页。',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: '要搜索的词或短语' } },
          required: ['query'],
          additionalProperties: false,
        },
        output: textOutput,
        async execute(args, exec) {
          const paperId = activePapers.get(String(exec.agent && exec.agent.id))
          if (!paperId) return { text: '当前会话没有打开的论文。请先在右侧栏「论文阅读」里打开一篇。' }
          const paper = await findPaper(paperId)
          if (!paper) return { text: '这篇论文已不在文献库中。' }
          const query = String((args && args.query) || '').trim()
          if (!query) return { text: '请提供要搜索的词。' }
          const hits = []
          const needle = query.toLowerCase()
          const maxPages = Math.min(paper.pages, 80)
          for (let page = 1; page <= maxPages && hits.length < 10; page++) {
            let text = ''
            try {
              text = await pageText(paper.id, paper, page)
            } catch {
              continue
            }
            const at = text.toLowerCase().indexOf(needle)
            if (at >= 0) {
              const start = Math.max(0, at - 100)
              hits.push(`第 ${page} 页：${text.slice(start, at + query.length + 160).replace(/\s+/g, ' ')}`)
            }
          }
          if (!hits.length) return { text: `没有找到「${query}」。` }
          return {
            text: `《${paper.title}》中「${query}」命中 ${hits.length} 处：\n${hits.join('\n')}\n\n跳页链接基址：${jumpBase(paper.id)}<页码>`,
          }
        },
      }),
    )
  }

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: '/paper-reflow',
      handler: async (req, res) => {
        try {
          await handle(req, res)
        } catch (error) {
          console.error('[paper-reflow] route error', error)
          if (!res.headersSent) {
            res.statusCode = 500
            res.end()
          }
        }
      },
    }),
  )
}
