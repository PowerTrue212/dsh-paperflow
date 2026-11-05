import { openDocument, reflowPage } from '../engine.mjs'

const base = process.env.LOCALAPPDATA + '\\dsh-paper-reflow\\papers\\'
const doc = await openDocument(base + '468cf47e7ce0\\source.pdf')
for (const page of [9, 10]) {
  const result = await reflowPage(doc, page)
  const regions = result.blocks
    .filter((block) => block.kind === 'image')
    .map((block) => `${block.role}:${block.bbox.join(',')}`)
  console.log('page', page, 'blocks', result.blocks.length, 'regions', regions.join(' | '))
  const text = result.blocks
    .filter((block) => block.kind === 'text')
    .slice(0, 8)
    .map((block) => block.text.slice(0, 50))
  for (const line of text) console.log('  ', line)
}
