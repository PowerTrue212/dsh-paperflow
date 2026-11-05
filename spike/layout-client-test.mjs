import { LayoutClient, layoutRegions } from '../layout.mjs'
import { openDocument, reflowPage } from '../engine.mjs'

const client = new LayoutClient({ python: process.execPath, worker: 'spike/mock-layout-worker.mjs' })
const boxes = await client.detect(Buffer.from('fake-png'), 612, 792)
console.log('boxes', boxes.length)
const regions = layoutRegions(boxes, 612, 792)
console.log('regions', JSON.stringify(regions))
client.close()

const doc = await openDocument('spike/fixtures/resnet.pdf')
const page = await reflowPage(doc, 4, 'auto', { extraRegions: regions })
console.log(
  'images',
  page.blocks
    .filter((block) => block.kind === 'image')
    .map((block) => `${block.role}:${block.bbox.map((value) => Math.round(value)).join(',')}`)
    .join(' | '),
)
for (const block of page.blocks.slice(0, 5)) console.log(' ', block.kind, block.text.slice(0, 60))
