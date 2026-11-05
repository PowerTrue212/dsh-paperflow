import { openDocument, reflowPage, documentInfo } from '../engine.mjs'

const file = process.argv[2] || 'spike/fixtures/resnet.pdf'
const doc = await openDocument(file)
console.log('info', await documentInfo(doc, 'fallback'))
const pages = Number(process.argv[3] || 3)
for (let n = 1; n <= pages; n++) {
  const r = await reflowPage(doc, n)
  console.log(`p${n}`, r.layout, `detected=${r.detectedLayout}`, `conf=${r.confidence}`, `blocks=${r.blocks.length}`)
  for (const b of r.blocks.slice(0, 3)) console.log(`   ${b.id} ${b.column} ${b.size} ${b.text.slice(0, 100)}`)
}
await doc.destroy()
