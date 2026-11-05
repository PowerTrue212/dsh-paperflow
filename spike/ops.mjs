import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const require = createRequire(import.meta.url)
const ROOT = path.dirname(require.resolve('pdfjs-dist/package.json')).replace(/\\/g, '/')
const { OPS } = pdfjs

const file = process.argv[2] || 'spike/fixtures/resnet.pdf'
const pageNumber = Number(process.argv[3] || 2)
const doc = await pdfjs.getDocument({
  data: new Uint8Array(fs.readFileSync(file)),
  cMapUrl: `${ROOT}/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${ROOT}/standard_fonts/`,
  useSystemFonts: true,
  isEvalSupported: false,
  verbosity: 0,
}).promise
const page = await doc.getPage(pageNumber)
const viewport = page.getViewport({ scale: 1 })
const ops = await page.getOperatorList()
console.log('page', pageNumber, viewport.width, viewport.height, 'ops', ops.fnArray.length)
const names = new Map(Object.entries(OPS).map(([name, value]) => [value, name]))
const counts = new Map()
for (const fn of ops.fnArray) counts.set(fn, (counts.get(fn) || 0) + 1)
const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
for (const [fn, count] of sorted) console.log(' ', names.get(fn) || fn, count)
const sample = ops.fnArray.indexOf(OPS.paintImageXObject)
if (sample >= 0) console.log('image args', ops.argsArray[sample])
const pathIndex = ops.fnArray.indexOf(OPS.constructPath)
if (pathIndex >= 0) {
  const args = ops.argsArray[pathIndex]
  console.log('constructPath args types', Array.isArray(args[0]) ? 'ops' : typeof args[0], Array.isArray(args[1]) ? 'coords' : typeof args[1], args[1]?.length)
}
await doc.destroy?.()
