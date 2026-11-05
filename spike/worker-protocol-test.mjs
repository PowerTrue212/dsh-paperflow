import path from 'node:path'

import { LayoutClient } from '../layout.mjs'

const client = new LayoutClient({
  python: 'python',
  worker: 'layout/worker.py',
  model: 'mock',
  env: {
    PYTHONPATH: path.resolve('spike/mock-paddleocr'),
    LAYOUT_NO_WARMUP: '1',
  },
})
const boxes = await client.detect(Buffer.from('fake-png'), 1224, 1584)
console.log(JSON.stringify(boxes, null, 1))
client.close()
process.exit(0)
