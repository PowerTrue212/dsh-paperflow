import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const require = createRequire(import.meta.url)
const PDFJS_ROOT = path.dirname(require.resolve('pdfjs-dist/package.json'))

/* ---------- ported from paper-reflow-lab/reflow.py ---------- */

const CJK_END = /[\u3400-\u9fff]$/
const CJK_START = /^[\u3400-\u9fff]/

function joinLines(lines) {
  let result = ''
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (!result) result = line
    else if (result.endsWith('-') && /^[a-z]/.test(line)) result = result.slice(0, -1) + line
    else if (CJK_END.test(result) && CJK_START.test(line)) result += line
    else result += ' ' + line
  }
  return result.replace(/\s+/g, ' ').trim()
}

/** lines: [{text, box:[x0,y0,x1,y1], size}] in top-left coordinates */
function splitLineGroups(lines) {
  if (!lines.length) return []
  const leftEdge = Math.min(...lines.map((l) => l.box[0]))
  const groups = []
  let group = []
  for (const line of lines) {
    if (group.length) {
      const prev = group[group.length - 1]
      const gap = line.box[1] - prev.box[3]
      const indent = Math.max(5.0, line.size * 0.65)
      const startsIndented = line.box[0] - leftEdge >= indent
      const previousUnindented = prev.box[0] - leftEdge < indent
      const newParagraph =
        lines.length >= 4 && startsIndented && previousUnindented && prev.text.length >= 20 && !prev.text.trimEnd().endsWith('-')
      const bulletBoundary = prev.text.startsWith('•') || line.text.startsWith('•')
      if (gap > Math.max(3.5, prev.size * 0.38) || newParagraph || bulletBoundary) {
        groups.push(group)
        group = []
      }
    }
    group.push(line)
  }
  if (group.length) groups.push(group)

  const chunks = []
  for (const paragraph of groups) {
    let chunk = []
    let chars = 0
    paragraph.forEach((line, index) => {
      chunk.push(line)
      chars += line.text.length
      const moreLines = paragraph.length - index - 1 >= 2
      const sentenceEnd = /[.!?。！？][\]\)"'’”]*\s*$/.test(line.text)
      if (moreLines && ((chars >= 550 && sentenceEnd) || (chars >= 1200 && chunk.length >= 12))) {
        chunks.push(chunk)
        chunk = []
        chars = 0
      }
    })
    if (chunk.length) chunks.push(chunk)
  }
  return chunks
}

function detectColumns(width, lineBoxes) {
  // Find the widest whitespace corridor near the page centre, ignoring
  // full-width elements (titles, abstracts, wide tables, figure captions).
  const step = 2
  const bins = new Uint8Array(Math.ceil(width / step) + 2)
  for (const box of lineBoxes) {
    if (box[2] - box[0] > width * 0.6) continue
    const from = Math.max(0, Math.floor(box[0] / step))
    const to = Math.min(bins.length - 1, Math.ceil(box[2] / step))
    for (let i = from; i <= to; i++) bins[i] = 1
  }
  let best = null
  let start = null
  const lo = Math.floor((width * 0.3) / step)
  const hi = Math.ceil((width * 0.7) / step)
  for (let i = lo; i <= hi; i++) {
    if (!bins[i]) {
      if (start === null) start = i
    } else if (start !== null) {
      const w = (i - start) * step
      if (!best || w > best.w) best = { left: start * step, right: i * step, w }
      start = null
    }
  }
  if (start !== null) {
    const w = (hi - start) * step
    if (!best || w > best.w) best = { left: start * step, right: hi * step, w }
  }
  const split = best && best.w >= Math.max(10, width * 0.015) ? (best.left + best.right) / 2 : width / 2
  const margin = 1.5
  const left = lineBoxes.filter((b) => b[2] <= split - margin)
  const right = lineBoxes.filter((b) => b[0] >= split + margin)
  const crossing = lineBoxes.length - left.length - right.length
  const total = Math.max(lineBoxes.length, 1)
  const two =
    Math.min(left.length, right.length) >= 6 &&
    Math.min(left.length, right.length) / total >= 0.17 &&
    crossing / total <= 0.38
  return { two, split }
}

function orderLines(lines, split, twoColumns) {
  const column = (l) => {
    if (l.box[2] <= split + 1) return 'left'
    if (l.box[0] >= split - 1) return 'right'
    return 'full'
  }
  if (!twoColumns)
    return lines
      .slice()
      .sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0])
      .map((line) => ({ line, column: 'full' }))

  const full = lines.filter((l) => column(l) === 'full').sort((a, b) => a.box[1] - b.box[1])
  const placed = new Set()
  const ordered = []
  const addBand = (top, bottom) => {
    const band = lines.filter((l) => {
      if (placed.has(l)) return false
      if (column(l) === 'full') return false
      const mid = (l.box[1] + l.box[3]) / 2
      return mid >= top && mid < bottom
    })
    for (const side of ['left', 'right']) {
      band
        .filter((l) => column(l) === side)
        .sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0])
        .forEach((l) => {
          ordered.push({ line: l, column: side })
          placed.add(l)
        })
    }
  }
  let top = -Infinity
  for (const l of full) {
    addBand(top, l.box[1])
    ordered.push({ line: l, column: 'full' })
    placed.add(l)
    top = l.box[3]
  }
  addBand(top, Infinity)
  for (const l of lines) if (!placed.has(l)) ordered.push({ line: l, column: column(l) })
  return ordered
}

/* ---------- pdf.js extraction ---------- */

function cleanText(text) {
  return text.replace(/\u0000/g, '').replace(/\uFB00/g, 'ff').replace(/\uFB01/g, 'fi').replace(/\uFB02/g, 'fl').replace(/\uFB03/g, 'ffi').replace(/\uFB04/g, 'ffl').replace(/\u00AD/g, '')
}

function lineSegmentsFromItems(items, pageHeight) {
  const boxes = []
  for (const item of items) {
    const text = cleanText(item.str || '')
    if (!text.trim()) continue
    const t = item.transform
    const angle = Math.atan2(t[1], t[0])
    if (Math.abs(angle) > 0.08 && Math.abs(Math.abs(angle) - Math.PI) > 0.08) continue
    const size = Math.max(Math.hypot(t[2], t[3]), 1)
    const x0 = t[4]
    const baseline = t[5]
    const y1 = pageHeight - baseline
    const y0 = y1 - size * 1.18
    boxes.push({ x0, x1: x0 + (item.width || 0), y0, y1, baseline, size, text, eol: !!item.hasEOL })
  }

  const finish = (runs) => {
    if (!runs.length) return null
    runs.sort((a, b) => a.x0 - b.x0)
    let text = ''
    let prev = null
    for (const run of runs) {
      if (!prev) text = run.text
      else {
        const gap = run.x0 - prev.x1
        const needsSpace = gap > run.size * 0.22 && !/\s$/.test(text) && !/^\s/.test(run.text)
        text += (needsSpace ? ' ' : '') + run.text
      }
      prev = run
    }
    return {
      text: text.replace(/\s+/g, ' ').trim(),
      box: [
        Math.min(...runs.map((r) => r.x0)),
        Math.min(...runs.map((r) => r.y0)),
        Math.max(...runs.map((r) => r.x1)),
        Math.max(...runs.map((r) => r.y1)),
      ],
      size: Math.max(...runs.map((r) => r.size)),
      baseline: Math.max(...runs.map((r) => r.baseline)),
    }
  }

  const lines = []
  for (const b of boxes) {
    let target = null
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 8; i--) {
      const line = lines[i]
      const overlap = Math.min(line.box[3], b.y1) - Math.max(line.box[1], b.y0)
      const vertical = overlap > Math.min(line.size, b.size) * 0.45
      const gap = b.x0 - line.box[2]
      const near = gap <= Math.max(4, line.size * 0.85) && b.x0 >= line.box[0] - line.size * 2
      if (vertical && near) {
        target = line
        break
      }
    }
    if (!target) {
      lines.push({ runs: [b], text: b.text, box: [b.x0, b.y0, b.x1, b.y1], size: b.size, baseline: b.baseline })
    } else {
      target.runs.push(b)
      target.box[0] = Math.min(target.box[0], b.x0)
      target.box[1] = Math.min(target.box[1], b.y0)
      target.box[2] = Math.max(target.box[2], b.x1)
      target.box[3] = Math.max(target.box[3], b.y1)
      target.size = Math.max(target.size, b.size)
      target.baseline = Math.max(target.baseline, b.baseline)
    }
  }

  for (const line of lines) {
    line.runs.sort((a, b) => a.x0 - b.x0)
    let text = ''
    let prev = null
    for (const run of line.runs) {
      if (!prev) text = run.text
      else {
        const gap = run.x0 - prev.x1
        const small = run.size < prev.size * 0.85
        const needsSpace = !small && gap > Math.max(0.6, prev.size * 0.12) && !/\s$/.test(text) && !/^\s/.test(run.text)
        text += (needsSpace ? ' ' : '') + run.text
      }
      prev = run
    }
    line.text = text.replace(/\s+/g, ' ').trim()
  }
  return lines.filter((l) => l.text)
}

function pageFromLines(width, height, lines) {
  const kept = lines.filter(
    (l) => !(/^\d{1,3}$/.test(l.text) && (l.box[1] < height * 0.09 || l.box[3] > height * 0.93)),
  )
  const lineBoxes = kept.filter((l) => l.text.length >= 5).map((l) => l.box)
  const { two, split } = detectColumns(width, lineBoxes)
  const ordered = orderLines(kept, split, two)
  const blocks = []

  // group consecutive ordered lines by column, then split each run into paragraphs
  const runs = []
  for (const entry of ordered) {
    const last = runs[runs.length - 1]
    if (last && last.column === entry.column) last.lines.push(entry.line)
    else runs.push({ column: entry.column, lines: [entry.line] })
  }
  for (const run of runs) {
    if (run.column === 'full' && run.lines.length <= 2) {
      for (const line of run.lines) blocks.push({ text: line.text, column: 'full', box: line.box, size: line.size })
      continue
    }
    for (const chunk of splitLineGroups(run.lines)) {
      const box = [
        Math.min(...chunk.map((l) => l.box[0])),
        Math.min(...chunk.map((l) => l.box[1])),
        Math.max(...chunk.map((l) => l.box[2])),
        Math.max(...chunk.map((l) => l.box[3])),
      ]
      blocks.push({ text: joinLines(chunk.map((l) => l.text)), column: run.column, box, size: Math.max(...chunk.map((l) => l.size)) })
    }
  }
  return { layout: two ? 'two' : 'single', blocks }
}

async function main() {
  const file = path.resolve(process.argv[2])
  const maxPages = Number(process.argv[3] || 3)
  const data = new Uint8Array(fs.readFileSync(file))
  const doc = await pdfjs.getDocument({
    data,
    cMapUrl: path.join(PDFJS_ROOT, 'cmaps').replace(/\\/g, '/') + '/',
    cMapPacked: true,
    standardFontDataUrl: path.join(PDFJS_ROOT, 'standard_fonts').replace(/\\/g, '/') + '/',
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0,
  }).promise
  const out = { file: path.basename(file), pages: [] }
  for (let n = 1; n <= Math.min(maxPages, doc.numPages); n++) {
    const page = await doc.getPage(n)
    const viewport = page.getViewport({ scale: 1 })
    const tc = await page.getTextContent({ includeMarkedContent: false })
    const lines = lineSegmentsFromItems(tc.items, viewport.height)
    const { layout, blocks } = pageFromLines(viewport.width, viewport.height, lines)
    const skipped = blocks.filter((b) => /^\d{1,3}$/.test(b.text)).length
    out.pages.push({
      page: n,
      width: Math.round(viewport.width * 10) / 10,
      height: Math.round(viewport.height * 10) / 10,
      layout,
      lines: lines.length,
      skippedPageNumbers: skipped,
      lineBoxes: lines.slice(0, 400).map((l) => ({ t: l.text.slice(0, 60), b: l.box.map((v) => Math.round(v)), s: Math.round(l.size * 10) / 10 })),
      blocks: blocks.map((b) => ({ text: b.text, column: b.column, box: b.box.map((v) => Math.round(v * 10) / 10) })),
    })
  }
  const target = process.argv[4] || path.join(path.dirname(file), path.basename(file, '.pdf') + '.js.json')
  fs.writeFileSync(target, JSON.stringify(out, null, 1))
  console.log(`${out.file}: ${out.pages.length} pages -> ${target}`)
  for (const p of out.pages) console.log(`  p${p.page}: ${p.layout} lines=${p.lines} blocks=${p.blocks.length}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
