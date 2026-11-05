import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const require = createRequire(import.meta.url)
const ROOT = path.dirname(require.resolve('pdfjs-dist/package.json')).replace(/\\/g, '/')
const { OPS } = pdfjs
const file = process.argv[2] || 'spike/fixtures/resnet.pdf'
const doc = await pdfjs.getDocument({
  data: new Uint8Array(fs.readFileSync(file)),
  cMapUrl: `${ROOT}/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${ROOT}/standard_fonts/`,
  useSystemFonts: true,
  isEvalSupported: false,
  verbosity: 0,
}).promise

function mul(m, t) {
  return [
    m[0] * t[0] + m[2] * t[1],
    m[1] * t[0] + m[3] * t[1],
    m[0] * t[2] + m[2] * t[3],
    m[1] * t[2] + m[3] * t[3],
    m[0] * t[4] + m[2] * t[5] + m[4],
    m[1] * t[4] + m[3] * t[5] + m[5],
  ]
}
function point(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}
function boxFromPoints(points) {
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

for (let pageNumber = 1; pageNumber <= 3; pageNumber++) {
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const ops = await page.getOperatorList()
  let ctm = [1, 0, 0, 1, 0, 0]
  const stack = []
  const raw = []
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    const args = ops.argsArray[i]
    if (fn === OPS.save) stack.push(ctm.slice())
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0]
    else if (fn === OPS.transform) ctm = mul(ctm, args)
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm.slice())
      const matrix = args[0]
      if (matrix) ctm = mul(ctm, matrix)
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0]
    else if (fn === OPS.constructPath) {
      const bbox = args[2]
      if (bbox && typeof bbox === 'object') {
        const a = point(ctm, bbox[0], bbox[1])
        const b = point(ctm, bbox[2], bbox[3])
        raw.push({ box: boxFromPoints([a, b]), kind: 'path' })
      }
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintJpegXObject) {
      const corners = [point(ctm, 0, 0), point(ctm, 1, 0), point(ctm, 0, 1), point(ctm, 1, 1)]
      raw.push({ box: boxFromPoints(corners), kind: 'image' })
    }
  }

  // to top-left page coordinates
  const toTop = (box) => [box[0], viewport.height - box[3], box[2], viewport.height - box[1]]
  let boxes = raw
    .map((entry) => ({ ...entry, box: toTop(entry.box) }))
    .filter(({ box }) => box[2] - box[0] >= 12 && box[3] - box[1] >= 6)

  // union-find clustering with a small margin
  const parent = boxes.map((_, index) => index)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }
  const near = (a, b, margin = 9) =>
    a[0] - margin <= b[2] && b[0] - margin <= a[2] && a[1] - margin <= b[3] && b[1] - margin <= a[3]
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (near(boxes[i].box, boxes[j].box)) union(i, j)
    }
  }
  const groups = new Map()
  boxes.forEach((entry, index) => {
    const root = find(index)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(entry)
  })
  const regions = []
  for (const entries of groups.values()) {
    if (entries.length < 3 && !entries.some((entry) => entry.kind === 'image')) continue
    const box = [
      Math.min(...entries.map((entry) => entry.box[0])),
      Math.min(...entries.map((entry) => entry.box[1])),
      Math.max(...entries.map((entry) => entry.box[2])),
      Math.max(...entries.map((entry) => entry.box[3])),
    ]
    const w = box[2] - box[0]
    const h = box[3] - box[1]
    if (w < 70 || h < 45 || w * h < 6000) continue
    if (w * h > viewport.width * viewport.height * 0.75) continue
    regions.push({ box: box.map((value) => Math.round(value)), count: entries.length, kinds: entries.filter((e) => e.kind === 'image').length })
  }
  regions.sort((a, b) => a.box[1] - b.box[1])
  console.log(`page ${pageNumber}: raw=${raw.length} boxes=${boxes.length} regions=${regions.length}`)
  for (const region of regions) console.log('  ', region)
}
await doc.destroy?.()
