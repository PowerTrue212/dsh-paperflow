/**
 * PDF text extraction and reading-order reflow.
 *
 * Ported from paper-reflow-lab/reflow.py (PyMuPDF) to pdf.js. The main
 * difference: pdf.js exposes text runs, not PyMuPDF's blocks, so lines are
 * rebuilt here and columns are found from the widest whitespace corridor in
 * the page centre instead of assuming an exact 50/50 split.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

let pdfjsCache = null

async function loadPdfjs() {
  if (!pdfjsCache) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    let root
    try {
      root = path.dirname(require.resolve('pdfjs-dist/package.json'))
    } catch {
      root = path.resolve(path.dirname(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')), '..', '..')
    }
    root = root.replace(/\\/g, '/')
    pdfjsCache = { pdfjs, root }
  }
  return pdfjsCache
}

const CJK_RE = /[\u3400-\u9fff]/
const CJK_END = /[\u3400-\u9fff]$/
const CJK_START = /^[\u3400-\u9fff]/
const SUPERSCRIPT = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' }

const MATH_ALNUM = /[\u{1D400}-\u{1D7FF}]/gu

function cleanText(text) {
  return text
    .replace(MATH_ALNUM, (ch) => ch.normalize('NFKC'))
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl')
    .replace(/[\uE000-\uF8FF]/g, '')
    .replace(/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/\u00AD/g, '')
}

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
  return result
    .replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitLineGroups(lines) {
  if (!lines.length) return []
  const leftEdge = Math.min(...lines.map((line) => line.box[0]))
  const groups = []
  let group = []
  for (const line of lines) {
    if (group.length) {
      const previous = group[group.length - 1]
      const gap = line.box[1] - previous.box[3]
      const indent = Math.max(5.0, line.size * 0.65)
      const startsIndented = line.box[0] - leftEdge >= indent
      const previousUnindented = previous.box[0] - leftEdge < indent
      const newParagraph =
        lines.length >= 4 &&
        startsIndented &&
        previousUnindented &&
        previous.text.length >= 20 &&
        !previous.text.trimEnd().endsWith('-')
      const bulletBoundary = previous.text.startsWith('•') || line.text.startsWith('•')
      if (gap > Math.max(3.5, previous.size * 0.38) || newParagraph || bulletBoundary) {
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

function buildLines(items, pageHeight) {
  const runs = []
  for (const item of items) {
    const raw = item.str || ''
    if (!raw.trim()) continue
    const t = item.transform
    const angle = Math.atan2(t[1], t[0])
    if (Math.abs(angle) > 0.08 && Math.abs(Math.abs(angle) - Math.PI) > 0.08) continue
    const size = Math.max(Math.hypot(t[2], t[3]), 1)
    const text = cleanText(raw)
    if (!text.trim()) continue
    const x0 = t[4]
    const baseline = t[5]
    const y1 = pageHeight - baseline
    const y0 = y1 - size * 1.18
    runs.push({ x0, x1: x0 + (item.width || 0), y0, y1, size, text })
  }

  const lines = []
  for (const run of runs) {
    let target = null
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 8; i--) {
      const line = lines[i]
      const overlap = Math.min(line.box[3], run.y1) - Math.max(line.box[1], run.y0)
      const vertical = overlap > Math.min(line.size, run.size) * 0.45
      const gap = run.x0 - line.box[2]
      const near = gap <= Math.max(4, line.size * 0.85) && run.x0 >= line.box[0] - line.size * 2
      if (vertical && near) {
        target = line
        break
      }
    }
    if (!target) {
      lines.push({ runs: [run], box: [run.x0, run.y0, run.x1, run.y1], size: run.size })
    } else {
      target.runs.push(run)
      target.box[0] = Math.min(target.box[0], run.x0)
      target.box[1] = Math.min(target.box[1], run.y0)
      target.box[2] = Math.max(target.box[2], run.x1)
      target.box[3] = Math.max(target.box[3], run.y1)
      target.size = Math.max(target.size, run.size)
    }
  }

  for (const line of lines) {
    line.runs.sort((a, b) => a.x0 - b.x0)
    let text = ''
    let previous = null
    for (const run of line.runs) {
      const small = run.size < line.size * 0.82
      const trimmed = run.text.trim()
      if (small && /^[*†‡§¶#′]{1,4}$/.test(trimmed)) continue
      let runText = run.text
      if (small && /^[0-9]{1,3}$/.test(trimmed)) {
        runText = Array.from(trimmed)
          .map((digit) => SUPERSCRIPT[digit] || digit)
          .join('')
      }
      if (!previous) {
        text = runText
      } else {
        const gap = run.x0 - previous.x1
        const cjk = CJK_END.test(text.trimEnd()) && CJK_START.test(runText.trimStart())
        const needsSpace =
          !small && !cjk && gap > Math.max(0.6, previous.size * 0.12) && !/\s$/.test(text) && !/^\s/.test(runText)
        text += (needsSpace ? ' ' : '') + runText
      }
      previous = run
    }
    line.text = text.replace(/\s+/g, ' ').trim()
  }
  return lines.filter((line) => line.text)
}

function detectColumns(width, lineBoxes) {
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
      const gap = (i - start) * step
      if (!best || gap > best.gap) best = { left: start * step, right: i * step, gap }
      start = null
    }
  }
  if (start !== null) {
    const gap = (hi - start) * step
    if (!best || gap > best.gap) best = { left: start * step, right: hi * step, gap }
  }
  const split = best && best.gap >= Math.max(10, width * 0.015) ? (best.left + best.right) / 2 : width / 2
  const margin = 1.5
  const left = lineBoxes.filter((box) => box[2] <= split - margin)
  const right = lineBoxes.filter((box) => box[0] >= split + margin)
  const crossing = lineBoxes.length - left.length - right.length
  const total = Math.max(lineBoxes.length, 1)
  const two =
    Math.min(left.length, right.length) >= 6 &&
    Math.min(left.length, right.length) / total >= 0.17 &&
    crossing / total <= 0.38
  const confidence = Math.round((Math.min(left.length, right.length) / total) * (1 - crossing / total) * 100) / 100
  return { two, split, confidence }
}

function orderLines(lines, split, twoColumns) {
  const columnOf = (line) => {
    if (line.box[2] <= split + 1) return 'left'
    if (line.box[0] >= split - 1) return 'right'
    return 'full'
  }
  if (!twoColumns) {
    return lines
      .slice()
      .sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0])
      .map((line) => ({ line, column: 'full' }))
  }

  const full = lines.filter((line) => columnOf(line) === 'full').sort((a, b) => a.box[1] - b.box[1])
  const placed = new Set()
  const ordered = []
  const addBand = (top, bottom) => {
    const band = lines.filter((line) => {
      if (placed.has(line) || columnOf(line) === 'full') return false
      const mid = (line.box[1] + line.box[3]) / 2
      return mid >= top && mid < bottom
    })
    for (const side of ['left', 'right']) {
      band
        .filter((line) => columnOf(line) === side)
        .sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0])
        .forEach((line) => {
          ordered.push({ line, column: side })
          placed.add(line)
        })
    }
  }
  let top = -Infinity
  for (const line of full) {
    addBand(top, line.box[1])
    ordered.push({ line, column: 'full' })
    placed.add(line)
    top = line.box[3]
  }
  addBand(top, Infinity)
  for (const line of lines) {
    if (!placed.has(line)) ordered.push({ line, column: columnOf(line) })
  }
  return ordered
}

function matrixMultiply(m, t) {
  return [
    m[0] * t[0] + m[2] * t[1],
    m[1] * t[0] + m[3] * t[1],
    m[0] * t[2] + m[2] * t[3],
    m[1] * t[2] + m[3] * t[3],
    m[0] * t[4] + m[2] * t[5] + m[4],
    m[1] * t[4] + m[3] * t[5] + m[5],
  ]
}

function transformPoint(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

function textCoverage(box, lineBoxes) {
  let covered = 0
  for (const line of lineBoxes) {
    const width = Math.min(box[2], line[2]) - Math.max(box[0], line[0])
    const height = Math.min(box[3], line[3]) - Math.max(box[1], line[1])
    if (width > 0 && height > 0) covered += width * height
  }
  return covered / Math.max(1, (box[2] - box[0]) * (box[3] - box[1]))
}

async function collectFigureRegions(page, lines, width, height) {
  const { pdfjs } = await loadPdfjs()
  const { OPS } = pdfjs
  let ops
  try {
    ops = await page.getOperatorList()
  } catch {
    return []
  }
  let ctm = [1, 0, 0, 1, 0, 0]
  const stack = []
  const boxes = []
  const push = (box) => {
    const w = box[2] - box[0]
    const h = box[3] - box[1]
    if (w < 1 && h < 1) return
    if (w > width * 0.9 && h < 6) return
    boxes.push(box)
  }
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    const args = ops.argsArray[i]
    if (fn === OPS.save) stack.push(ctm.slice())
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0]
    else if (fn === OPS.transform) ctm = matrixMultiply(ctm, args)
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm.slice())
      if (args[0]) ctm = matrixMultiply(ctm, args[0])
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0]
    else if (fn === OPS.constructPath) {
      const bbox = args[2]
      if (!bbox) continue
      const a = transformPoint(ctm, Number(bbox[0]), Number(bbox[1]))
      const b = transformPoint(ctm, Number(bbox[2]), Number(bbox[3]))
      push([
        Math.min(a[0], b[0]),
        height - Math.max(a[1], b[1]),
        Math.max(a[0], b[0]),
        height - Math.min(a[1], b[1]),
      ])
    } else if (
      fn === OPS.paintImageXObject ||
      fn === OPS.paintInlineImageXObject ||
      fn === OPS.paintJpegXObject
    ) {
      const corners = [
        transformPoint(ctm, 0, 0),
        transformPoint(ctm, 1, 0),
        transformPoint(ctm, 0, 1),
        transformPoint(ctm, 1, 1),
      ]
      const xs = corners.map((point) => point[0])
      const ys = corners.map((point) => point[1])
      push([Math.min(...xs), height - Math.max(...ys), Math.max(...xs), height - Math.min(...ys)])
    }
  }
  if (!boxes.length) return []

  const parent = boxes.map((_, index) => index)
  const find = (index) => (parent[index] === index ? index : (parent[index] = find(parent[index])))
  const union = (a, b) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent[rootB] = rootA
  }
  const near = (a, b, margin = 8) =>
    a[0] - margin <= b[2] && b[0] - margin <= a[2] && a[1] - margin <= b[3] && b[1] - margin <= a[3]
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (near(boxes[i], boxes[j])) union(i, j)
    }
  }
  const groups = new Map()
  boxes.forEach((box, index) => {
    const root = find(index)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(box)
  })

  const lineBoxes = lines.filter((line) => line.text.length >= 5).map((line) => line.box)
  const regions = []
  for (const group of groups.values()) {
    const box = [
      Math.min(...group.map((b) => b[0])),
      Math.min(...group.map((b) => b[1])),
      Math.max(...group.map((b) => b[2])),
      Math.max(...group.map((b) => b[3])),
    ]
    const w = box[2] - box[0]
    const h = box[3] - box[1]
    if (w < 60 || h < 40 || w * h < 2500) continue
    if (h > w * 4.5) continue
    if (w * h > width * height * 0.75) continue
    const coverage = textCoverage(box, lineBoxes)
    if (coverage > 0.6) continue
    // A single big empty rectangle is usually a diagram frame, a table frame, or a figure.
    if (group.length < 3 && !(w >= 100 && h >= 70 && w * h >= 12000 && coverage < 0.25)) continue
    regions.push(box)
  }

  regions.sort((a, b) => (b[2] - b[0]) * (b[3] - b[1]) - (a[2] - a[0]) * (a[3] - a[1]))
  const kept = []
  const overlap = (a, b) => {
    const x = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
    const y = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
    return (x * y) / Math.max(1, Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])))
  }
  for (const box of regions) {
    if (kept.some((existing) => overlap(existing, box) > 0.6)) continue
    kept.push(box)
  }
  // Keep only a small uniform margin: aggressively absorbing nearby short
  // lines can swallow a neighbouring column's headings or body text.
  const padding = [10, 6, 10, 4]
  return kept.map((box) => ({
    role: 'figure',
    bbox: [
      Math.round(Math.max(0, box[0] - padding[0]) * 10) / 10,
      Math.round(Math.max(0, box[1] - padding[1]) * 10) / 10,
      Math.round(Math.min(width, box[2] + padding[2]) * 10) / 10,
      Math.round(Math.min(height, box[3] + padding[3]) * 10) / 10,
    ],
  }))
}

function detectTableRegions(lines, width, height) {
  if (!lines.length) return []
  const rows = new Map()
  for (const line of lines) {
    const center = (line.box[1] + line.box[3]) / 2
    let key = null
    for (const existing of rows.keys()) {
      if (Math.abs(existing - center) <= 3) {
        key = existing
        break
      }
    }
    if (key === null) {
      key = center
      rows.set(key, [])
    }
    rows.get(key).push(line)
  }

  const rowList = [...rows.entries()]
    .map(([center, entries]) => {
      entries.sort((a, b) => a.box[0] - b.box[0])
      const clusters = []
      for (const entry of entries) {
        const last = clusters[clusters.length - 1]
        if (last && entry.box[0] - last.x1 < 40) {
          last.x1 = Math.max(last.x1, entry.box[2])
          last.text += ' ' + entry.text
          last.cells += 1
        } else {
          clusters.push({ x0: entry.box[0], x1: entry.box[2], text: entry.text, cells: 1 })
        }
      }
      // A row may mix a table with a neighbouring column's prose on the same
      // baseline. Keep the cell group around the check marks, ignoring long
      // prose runs further away.
      const hasCheck = (text) => /(?:^|\s)[Xx×✗✘√✓✔](?=\s|$)/.test(text)
      const checked = clusters.filter((cluster) => hasCheck(cluster.text))
      let x0 = clusters[0].x0
      let x1 = clusters[clusters.length - 1].x1
      let checks = 0
      let text = clusters.map((cluster) => cluster.text).join(' ')
      if (checked.length) {
        const left = Math.min(...checked.map((cluster) => cluster.x0))
        const right = Math.max(...checked.map((cluster) => cluster.x1))
        const selected = clusters.filter(
          (cluster) =>
            hasCheck(cluster.text) ||
            (cluster.text.trim().length <= 30 && cluster.x1 >= left - 120 && cluster.x0 <= right + 120),
        )
        x0 = Math.min(...selected.map((cluster) => cluster.x0))
        x1 = Math.max(...selected.map((cluster) => cluster.x1))
        text = selected.map((cluster) => cluster.text).join(' ')
        checks = (text.match(/(?:^|\s)[Xx×✗✘√✓✔](?=\s|$)/g) || []).length
      }
      return {
        center,
        y0: Math.min(...entries.map((entry) => entry.box[1])),
        y1: Math.max(...entries.map((entry) => entry.box[3])),
        x0,
        x1,
        clusters: clusters.length,
        checks,
        text,
        loose: (() => {
          const scored = clusters.map((cluster) => {
            const digits = (cluster.text.match(/\d/g) || []).length
            const commas = (cluster.text.match(/,/g) || []).length
            const slashes = (cluster.text.match(/\//g) || []).length
            return {
              x0: cluster.x0,
              x1: cluster.x1,
              text: cluster.text,
              digits,
              commas,
              slashes,
              score: digits + commas * 2 + slashes * 2,
            }
          })
          let best = scored[0]
          for (const item of scored) if (item.score > best.score) best = item
          return best
        })(),
      }
    })
    .sort((a, b) => a.center - b.center)

  const tableRows = rowList.filter((row) => row.checks >= 2)
  if (process.env.PR_DEBUG) {
    console.error('[tables] rows', rowList.length, 'candidates', tableRows.length)
    for (const row of rowList) console.error('  row', row.y0.toFixed(0), row.checks, row.clusters, JSON.stringify(row.text.slice(0, 48)))
  }
  const groups = []
  let current = null
  for (const row of tableRows) {
    if (!current) {
      current = { ...row, rows: 1 }
      continue
    }
    const gap = row.y0 - current.y1
    const overlap = Math.min(row.x1, current.x1) - Math.max(row.x0, current.x0)
    const narrower = Math.min(row.x1 - row.x0, current.x1 - current.x0)
    if (gap <= 24 && overlap > narrower * 0.35) {
      current.y1 = Math.max(current.y1, row.y1)
      current.x0 = Math.min(current.x0, row.x0)
      current.x1 = Math.max(current.x1, row.x1)
      current.rows += 1
      current.checks += row.checks
    } else {
      groups.push(current)
      current = { ...row, rows: 1 }
    }
  }
  if (current) groups.push(current)

  const regions = []
  for (const group of groups) {
    if (group.rows < 2 && group.checks < 3) continue
    const w = group.x1 - group.x0
    const h = group.y1 - group.y0
    if (w < 120 || h < 16) continue
    let y0 = group.y0
    for (const row of rowList) {
      if (row.y1 <= group.y0 - 1 && row.y1 >= group.y0 - 24 && row.text.length <= 60 && !/[.。!?,;:]$/.test(row.text)) {
        y0 = Math.min(y0, row.y0)
        group.x0 = Math.min(group.x0, row.x0)
        group.x1 = Math.max(group.x1, row.x1)
      }
    }
    regions.push({
      role: 'table',
      bbox: [
        Math.max(0, group.x0 - 4),
        Math.max(0, y0 - 4),
        Math.min(width, group.x1 + 4),
        Math.min(height, group.y1 + 4),
      ].map((value) => Math.round(value * 10) / 10),
    })
  }
  // Caption-anchored tables. Captions can sit above the table (most papers)
  // or below it (e.g. CodeTransOcean); try the block below the caption first,
  // then fall back to the block above it.
  const captionRows = rowList.filter((row) => /^(table|\u8868)\s*\d+/i.test(row.text.trim()))
  for (const caption of captionRows) {
    const index = rowList.indexOf(caption)
    // Skip the caption's own wrapped lines (same left edge, tight leading).
    let cursor = index + 1
    let lastBottom = caption.y1
    while (cursor < rowList.length) {
      const row = rowList[cursor]
      if (row.y0 < caption.y1 - 1) {
        cursor += 1
        continue
      }
      if (row.y0 - lastBottom > 14) break
      if (Math.abs(row.x0 - caption.x0) > 10) break
      lastBottom = row.y1
      cursor += 1
    }
    const topY = lastBottom + 6
    const below = []
    for (; cursor < rowList.length; cursor += 1) {
      const row = rowList[cursor]
      const previous = below[below.length - 1]
      const gap = previous ? row.y0 - previous.y1 : row.y0 - topY
      if (gap > 48) break
      const text = row.text.trim()
      if (!text) continue
      if (/^(table|figure|\u8868|\u56fe)\s*\d+/i.test(text)) break
      const numbers = (text.match(/\d+(?:[.,]\d+)?/g) || []).length
      const words = (text.match(/[A-Za-z\u4e00-\u9fff]{2,}/g) || []).length
      const endsNumber = /[0-9](?:[.,][0-9]+)?%?\s*$/.test(text)
      const numericRow = numbers >= 2 && endsNumber
      const leadingHeader = below.length <= 1
      const isHeader = numbers <= 1 && text.length <= 90 && (leadingHeader || row.x1 - row.x0 < 340)
      if (!numericRow && !isHeader) break
      below.push(row)
    }
    const belowNumeric = below.filter((row) => /\d/.test(row.text)).length
    if (below.length >= 4 && belowNumeric >= 2) {
      const y0 = topY
      const y1 = Math.max(...below.map((row) => row.y1))
      const x0 = Math.min(...below.map((row) => row.x0), caption.x0)
      const x1 = Math.max(...below.map((row) => row.x1), caption.x1)
      if (x1 - x0 >= 120 && y1 - y0 >= 30) {
        regions.push({
          role: 'table',
          bbox: [
            Math.max(0, x0 - 4),
            Math.max(0, y0 - 2),
            Math.min(width, x1 + 4),
            Math.min(height, y1 + 4),
          ].map((value) => Math.round(value * 10) / 10),
        })
        continue
      }
    }
    const collected = []
    for (let cursor2 = index - 1; cursor2 >= 0; cursor2 -= 1) {
      const row = rowList[cursor2]
      if (row.y1 > caption.y0 - 1) continue
      const previous = collected[collected.length - 1]
      const gap = previous ? previous.y0 - row.y1 : caption.y0 - row.y1
      if (gap > 32) break
      const text = row.text.trim()
      const withoutEllipsis = text.replace(/[.\u2026]+$/, '')
      if (withoutEllipsis.length > 0 && /[.\u3002!?]$/.test(withoutEllipsis)) break
      if (text.length > 85 && !/[\/|]/.test(text)) break
      collected.push(row)
    }
    if (collected.length < 4) continue
    const numeric = collected.filter((row) => /\d/.test(row.text)).length
    if (numeric < 2) continue
    const y0 = Math.min(...collected.map((row) => row.y0))
    const x0 = Math.min(...collected.map((row) => row.x0), caption.x0)
    const x1 = Math.max(...collected.map((row) => row.x1), caption.x1)
    if (x1 - x0 < 120 || caption.y0 - y0 < 30) continue
    regions.push({
      role: 'table',
      bbox: [
        Math.max(0, x0 - 4),
        Math.max(0, y0 - 4),
        Math.min(width, x1 + 4),
        Math.min(height, caption.y0 + 2),
      ].map((value) => Math.round(value * 10) / 10),
    })
  }

  // Column-filling diagrams (ResNet page 4: three architecture columns made
  // of short labels). If the column above a "Figure N" caption is almost
  // entirely short labels, treat the whole column as one figure.
  const ranked = regions.slice().sort((a, b) => {
    const areaA = (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1])
    const areaB = (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1])
    return areaB - areaA
  })
  const kept = []
  for (const region of ranked) {
    const area = (region.bbox[2] - region.bbox[0]) * (region.bbox[3] - region.bbox[1])
    const duplicate = kept.some((other) => {
      const x = Math.max(0, Math.min(region.bbox[2], other.bbox[2]) - Math.max(region.bbox[0], other.bbox[0]))
      const y = Math.max(0, Math.min(region.bbox[3], other.bbox[3]) - Math.max(region.bbox[1], other.bbox[1]))
      const otherArea = (other.bbox[2] - other.bbox[0]) * (other.bbox[3] - other.bbox[1])
      return (x * y) / Math.max(1, Math.min(area, otherArea)) > 0.6
    })
    if (!duplicate) kept.push(region)
  }
  return kept
}

function insertRegions(blocks, regions, split, pageNumber) {
  const result = blocks.slice()
  // The projection split can drift on pages whose top matter is full-width
  // (title, author row). Use the actual x-range of each text column instead,
  // so a figure at the top of the right column is not treated as full-width.
  const textBlocks = blocks.filter((block) => block.kind !== 'image' && block.bbox && block.role !== 'meta')
  const pool = textBlocks.length ? textBlocks : blocks.filter((block) => block.kind !== 'image' && block.bbox)
  const range = (items) =>
    items.length ? [Math.min(...items.map((item) => item.bbox[0])), Math.max(...items.map((item) => item.bbox[2]))] : null
  const leftRange = range(pool.filter((block) => block.column === 'left'))
  const rightRange = range(pool.filter((block) => block.column === 'right'))
  const sorted = regions.slice().sort((a, b) => a.bbox[1] - b.bbox[1])
  sorted.forEach((region, index) => {
    const box = region.bbox
    let column = 'full'
    if (leftRange && rightRange) {
      const center = (box[0] + box[2]) / 2
      const inLeft = center >= leftRange[0] - 2 && center <= leftRange[1] + 2
      const inRight = center >= rightRange[0] - 2 && center <= rightRange[1] + 2
      if (inRight && !inLeft) column = 'right'
      else if (inLeft && !inRight) column = 'left'
    } else {
      column = box[2] <= split + 1 ? 'left' : box[0] >= split - 1 ? 'right' : 'full'
    }
    let position = -1
    if (column === 'full') {
      position = result.findIndex((block) => block.bbox[1] >= box[3] - 2)
    } else {
      const indexes = result
        .map((block, blockIndex) => ({ block, blockIndex }))
        .filter((entry) => entry.block.column === column)
      const hit = indexes.find((entry) => entry.block.bbox[1] >= box[3] - 2)
      if (hit) position = hit.blockIndex
      else if (indexes.length) position = indexes[indexes.length - 1].blockIndex + 1
    }
    if (position < 0) position = result.length
    result.splice(position, 0, {
      id: `p${pageNumber}r${index}`,
      kind: 'image',
      role: region.role,
      text: '',
      column,
      size: 0,
      bbox: box,
    })
  })
  return result
}

function markMetaBlocks(blocks, pageHeight) {
  if (blocks.length < 2) return
  // The title is the largest text block in the upper half, not necessarily
  // the first block (a date or running header can precede it).
  let titleIndex = -1
  let titleSize = 0
  blocks.forEach((block, index) => {
    if (block.kind === 'image') return
    if (block.bbox[1] > pageHeight * 0.5) return
    if (block.size > titleSize + 0.1) {
      titleSize = block.size
      titleIndex = index
    }
  })
  if (titleIndex < 0) titleIndex = 0

  const heading = blocks.findIndex(
    (block, index) => index > titleIndex && /^(abstract|摘要)\b/i.test(block.text.trim()),
  )
  if (heading > titleIndex + 1) {
    for (let index = titleIndex + 1; index < heading; index++) {
      if (blocks[index].kind !== 'image') blocks[index].role = 'meta'
    }
    return
  }

  // No "Abstract" heading survived extraction (some templates render it as
  // artwork or letterspaced text). Only hide explicit metadata near the top;
  // never blank out long paragraphs, which are the abstract itself.
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]
    if (block.kind === 'image' || index === titleIndex) continue
    if (block.bbox[1] > pageHeight * 0.35) continue
    const text = block.text.trim()
    if (text.length > 400) continue
    if (
      /@|university|institute|laborator|department|school of|college of|大学|学院|研究所|实验室/i.test(text) ||
      /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(text) ||
      /^\s*(website|code|hugging face|arxiv|doi|corresponding author)/i.test(text) ||
      /[\u00B9\u00B2\u00B3\u2070-\u2079]/.test(text)
    ) {
      block.role = 'meta'
    }
  }
}

export function bestTitle(blocks) {
  const candidates = blocks.filter(
    (block) => block.kind !== 'image' && block.role !== 'meta' && block.text.length >= 6 && block.text.length <= 220,
  )
  if (!candidates.length) return ''
  let best = candidates[0]
  for (const block of candidates) if (block.size > best.size + 0.6) best = block
  return best.text.trim()
}

function blocksFromLines(width, height, lines, mode, pageNumber, regions) {
  const kept = lines.filter(
    (line) => !(/^\d{1,3}$/.test(line.text) && (line.box[1] < height * 0.09 || line.box[3] > height * 0.93)),
  )
  const lineBoxes = kept.filter((line) => line.text.length >= 5).map((line) => line.box)
  const detected = detectColumns(width, lineBoxes)
  const two = mode === 'two' ? true : mode === 'single' ? false : detected.two
  const ordered = orderLines(kept, detected.split, two)

  const runs = []
  for (const entry of ordered) {
    const last = runs[runs.length - 1]
    if (last && last.column === entry.column) last.lines.push(entry.line)
    else runs.push({ column: entry.column, lines: [entry.line] })
  }

  const blocks = []
  let index = 0
  const push = (text, column, chunk) => {
    if (!text) return
    blocks.push({
      id: `b${index++}`,
      kind: 'text',
      text,
      column,
      size: Math.round(Math.max(...chunk.map((line) => line.size)) * 10) / 10,
      bbox: [
        Math.round(Math.min(...chunk.map((line) => line.box[0])) * 10) / 10,
        Math.round(Math.min(...chunk.map((line) => line.box[1])) * 10) / 10,
        Math.round(Math.max(...chunk.map((line) => line.box[2])) * 10) / 10,
        Math.round(Math.max(...chunk.map((line) => line.box[3])) * 10) / 10,
      ],
    })
  }
  for (const run of runs) {
    if (run.column === 'full' && run.lines.length <= 2) {
      for (const line of run.lines) push(line.text, 'full', [line])
      continue
    }
    for (const chunk of splitLineGroups(run.lines)) push(joinLines(chunk.map((line) => line.text)), run.column, chunk)
  }
  const withRegions = regions && regions.length ? insertRegions(blocks, regions, detected.split, pageNumber) : blocks
  if (pageNumber === 1) markMetaBlocks(withRegions, height)
  return {
    layout: two ? 'two' : 'single',
    detectedLayout: detected.two ? 'two' : 'single',
    confidence: detected.confidence,
    split: Math.round(detected.split * 10) / 10,
    blocks: withRegions,
  }
}

export async function openDocument(file) {
  const { pdfjs, root } = await loadPdfjs()
  const data = new Uint8Array(await fs.promises.readFile(file))
  const doc = await pdfjs.getDocument({
    data,
    cMapUrl: `${root}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${root}/standard_fonts/`,
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0,
  }).promise
  return doc
}

export async function reflowPage(doc, pageNumber, mode = 'auto', options = {}) {
  if (mode !== 'auto' && mode !== 'two' && mode !== 'single') throw new Error('invalid mode')
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) throw new Error('invalid page')
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent({ includeMarkedContent: false })
  const lines = buildLines(content.items, viewport.height)
  const tables = detectTableRegions(lines, viewport.width, viewport.height)
  const tableBoxes = tables.map((region) => region.bbox)
  const isInside = (line, boxes) => {
    const cx = (line.box[0] + line.box[2]) / 2
    const cy = (line.box[1] + line.box[3]) / 2
    return boxes.some((box) => cx >= box[0] - 2 && cx <= box[2] + 2 && cy >= box[1] - 2 && cy <= box[3] + 2)
  }
  const withoutTables = lines.filter((line) => !isInside(line, tableBoxes))
  const rawFigures = await collectFigureRegions(page, withoutTables, viewport.width, viewport.height)
  // A vector figure sits among short labels; a cluster that reaches into
  // full-width body text should be trimmed to its text-free part instead of
  // swallowing paragraphs.
  const figures = []
  for (const figure of rawFigures) {
    const [x0, y0, x1, y1] = figure.bbox
    const wideLines = withoutTables
      .filter((line) => {
        const cx = (line.box[0] + line.box[2]) / 2
        const cy = (line.box[1] + line.box[3]) / 2
        return cx >= x0 - 2 && cx <= x1 + 2 && cy >= y0 - 2 && cy <= y1 + 2 && line.box[2] - line.box[0] > 120
      })
      .sort((a, b) => a.box[1] - b.box[1])
    if (wideLines.length < 2) {
      figures.push(figure)
      continue
    }
    const first = wideLines[0]
    const last = wideLines[wideLines.length - 1]
    const topPart = first.box[1] - y0
    const bottomPart = y1 - last.box[3]
    if (topPart >= bottomPart && topPart >= 60) {
      figures.push({ role: figure.role, bbox: [x0, y0, x1, first.box[1] - 4] })
    } else if (bottomPart >= 60) {
      figures.push({ role: figure.role, bbox: [x0, last.box[3] + 4, x1, y1] })
    }
  }
  const heuristicRegions = [...tables, ...figures.filter((figure) => !tables.some((table) => {
    const a = figure.bbox
    const b = table.bbox
    const x = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
    const y = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
    return (x * y) / Math.max(1, Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))) > 0.25
  }))]
  // Layout-model regions (when enabled) replace the heuristic regions they
  // overlap; everything else keeps the fast path.
  const extraRegions = Array.isArray(options.extraRegions) ? options.extraRegions : []
  const regions = extraRegions.length
    ? heuristicRegions.filter((region) => {
        return !extraRegions.some((item) => {
          const a = region.bbox
          const b = item.bbox
          const x = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
          const y = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
          const areaA = (a[2] - a[0]) * (a[3] - a[1])
          const areaB = (b[2] - b[0]) * (b[3] - b[1])
          return (x * y) / Math.max(1, Math.min(areaA, areaB)) > 0.3
        })
      })
    : heuristicRegions.slice()
  if (extraRegions.length) regions.push(...extraRegions)
  const allBoxes = regions.map((region) => region.bbox)
  const outside = lines.filter((line) => !isInside(line, allBoxes))
  const result = blocksFromLines(viewport.width, viewport.height, outside, mode, pageNumber, regions)
  return {
    page: pageNumber,
    width: Math.round(viewport.width * 10) / 10,
    height: Math.round(viewport.height * 10) / 10,
    layout: result.layout,
    detectedLayout: result.detectedLayout,
    confidence: result.confidence,
    blocks: result.blocks,
  }
}

export async function documentInfo(doc, fallbackTitle) {
  let title = ''
  try {
    const meta = await doc.getMetadata()
    title = String(meta?.info?.Title || '').trim()
  } catch {
    title = ''
  }
  if (!title || title.toLowerCase().endsWith('.pdf')) title = fallbackTitle
  return { pages: doc.numPages, title: title.slice(0, 200) }
}
