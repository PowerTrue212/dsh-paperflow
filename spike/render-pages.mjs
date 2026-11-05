import fs from 'node:fs'
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas'
import { openDocument } from '../engine.mjs'

globalThis.DOMMatrix = DOMMatrix
globalThis.ImageData = ImageData
globalThis.Path2D = Path2D

const base = process.env.LOCALAPPDATA + '\\dsh-paper-reflow\\papers\\'
const doc = await openDocument(base + '468cf47e7ce0\\source.pdf')
for (const pageNumber of [9, 10]) {
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1.3 })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise
  const file = `spike/fixtures/t2j-p${pageNumber}.png`
  fs.writeFileSync(file, await canvas.encode('png'))
  console.log('saved', file, canvas.width, canvas.height)
}
