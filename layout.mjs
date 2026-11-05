/**
 * Optional local layout detector (PaddleOCR LayoutDetection).
 *
 * The worker is a Python process that keeps the model loaded and answers
 * JSON lines with normalized boxes. Everything is local: no API key, no
 * per-page billing. If the interpreter, the worker, or the model is missing,
 * the caller falls back to the heuristic reflow.
 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'

const FIGURE_LABELS = new Set(['figure', 'image', 'chart', 'picture'])
const TABLE_LABELS = new Set(['table'])

function normalizeLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

export class LayoutClient {
  constructor({ python, worker, model = 'PP-DocLayout-M', timeout = 120_000, env = {} }) {
    this.python = python
    this.worker = worker
    this.model = model
    this.timeout = timeout
    this.env = env
    this.child = null
    this.pending = new Map()
    this.buffer = ''
  }

  start() {
    if (this.child && !this.child.killed) return this.child
    if (!this.python || !this.worker) throw new Error('layout python/worker is not configured')
    const child = spawn(this.python, [this.worker], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, LAYOUT_MODEL: this.model, ...this.env },
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      this.buffer += chunk
      let index = this.buffer.indexOf('\n')
      while (index >= 0) {
        const line = this.buffer.slice(0, index).trim()
        this.buffer = this.buffer.slice(index + 1)
        if (line) this.handleLine(line)
        index = this.buffer.indexOf('\n')
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', () => {})
    const fail = (error) => {
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer)
        entry.reject(error)
      }
      this.pending.clear()
      if (this.child === child) this.child = null
    }
    child.on('error', (error) => fail(error))
    child.on('exit', (code) => fail(new Error(`layout worker exited (${code})`)))
    this.child = child
    return child
  }

  handleLine(line) {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    const entry = this.pending.get(message.id)
    if (!entry) return
    this.pending.delete(message.id)
    clearTimeout(entry.timer)
    if (message.error) entry.reject(new Error(message.error))
    else entry.resolve(Array.isArray(message.boxes) ? message.boxes : [])
  }

  detect(image, width, height) {
    return new Promise((resolve, reject) => {
      let child
      try {
        child = this.start()
      } catch (error) {
        reject(error)
        return
      }
      const id = crypto.randomUUID()
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('layout timeout'))
      }, this.timeout)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, image: image.toString('base64'), width, height })}\n`)
    })
  }

  close() {
    if (this.child) {
      try {
        this.child.stdin.write('{"cmd":"quit"}\n')
      } catch {
        /* ignore */
      }
      this.child.kill()
      this.child = null
    }
  }
}

function mergeBoxes(boxes) {
  const merged = []
  for (const box of boxes.slice().sort((a, b) => a.y0 - b.y0)) {
    const target = merged.find((item) => {
      const overlapX = Math.min(item.x1, box.x1) - Math.max(item.x0, box.x0)
      const narrower = Math.min(item.x1 - item.x0, box.x1 - box.x0)
      return overlapX > narrower * 0.4 && box.y0 - item.y1 < 0.03
    })
    if (target) {
      target.x0 = Math.min(target.x0, box.x0)
      target.y0 = Math.min(target.y0, box.y0)
      target.x1 = Math.max(target.x1, box.x1)
      target.y1 = Math.max(target.y1, box.y1)
    } else {
      merged.push({ ...box })
    }
  }
  return merged
}

export function layoutRegions(boxes, pageWidth, pageHeight) {
  const figures = []
  const tables = []
  for (const box of boxes || []) {
    const label = normalizeLabel(box.label)
    if (!label || label.includes('caption')) continue
    const normalized = {
      x0: Math.max(0, Math.min(1, Number(box.x0))),
      y0: Math.max(0, Math.min(1, Number(box.y0))),
      x1: Math.max(0, Math.min(1, Number(box.x1))),
      y1: Math.max(0, Math.min(1, Number(box.y1))),
    }
    if (!(normalized.x1 > normalized.x0) || !(normalized.y1 > normalized.y0)) continue
    if (FIGURE_LABELS.has(label)) figures.push(normalized)
    else if (TABLE_LABELS.has(label)) tables.push(normalized)
  }
  const toRegion = (box, role) => {
    const pad = 2
    return {
      role,
      bbox: [
        Math.max(0, box.x0 * pageWidth - pad),
        Math.max(0, box.y0 * pageHeight - pad),
        Math.min(pageWidth, box.x1 * pageWidth + pad),
        Math.min(pageHeight, box.y1 * pageHeight + pad),
      ].map((value) => Math.round(value * 10) / 10),
    }
  }
  return [
    ...mergeBoxes(tables).map((box) => toRegion(box, 'table')),
    ...mergeBoxes(figures).map((box) => toRegion(box, 'figure')),
  ]
}
