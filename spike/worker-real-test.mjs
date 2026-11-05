import fs from 'node:fs'

import { LayoutClient } from '../layout.mjs'

const client = new LayoutClient({
  python: '.venv-layout\\Scripts\\python.exe',
  worker: 'layout/worker.py',
  model: 'PP-DocLayout-M',
})
const image = fs.readFileSync('spike/fixtures/layout/resnet-p4.png')
const boxes = await client.detect(image, 1224, 1584)
console.log(
  'boxes',
  boxes.length,
  boxes.filter((box) => box.label === 'image').map((box) => [box.x0, box.y0, box.x1, box.y1].map((v) => v.toFixed(3)).join(',')),
)
client.close()
process.exit(0)
