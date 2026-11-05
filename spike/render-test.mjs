import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

globalThis.DOMMatrix = DOMMatrix
globalThis.ImageData = ImageData
globalThis.Path2D = Path2D

const require = createRequire(import.meta.url)
const ROOT = path.dirname(require.resolve('pdfjs-dist/package.json')).replace(/\\/g, '/')
const file = process.argv[2] || 'spike/fixtures/resnet.pdf'
const pageNumber = Number(process.argv[3] || 2)
const scale = Number(process.argv[4] || 1.5)

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
const viewport = page.getViewport({ scale })
const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
const ctx = canvas.getContext('2d')
ctx.fillStyle = '#fff'
ctx.fillRect(0, 0, canvas.width, canvas.height)
await page.render({ canvasContext: ctx, viewport }).promise
const png = await canvas.encode('png')
const out = process.argv[5] || `spike/fixtures/render-p${pageNumber}.png`
fs.writeFileSync(out, png)
console.log('wrote', out, canvas.width, canvas.height, png.length)
await doc.destroy?.()
