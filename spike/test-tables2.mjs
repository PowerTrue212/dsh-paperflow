import { openDocument, reflowPage } from '../engine.mjs'

const base = process.env.LOCALAPPDATA + '\\dsh-paper-reflow\\papers\\'
const cases = [
  ['468cf47e7ce0', 9],
  ['468cf47e7ce0', 10],
  ['a9b8fc4149a5', 2],
  ['13f1895e5c88', 3],
]
for (const [pid, page] of cases) {
  const doc = await openDocument(base + pid + '\\source.pdf')
  const result = await reflowPage(doc, page)
  const regions = result.blocks
    .filter((block) => block.kind === 'image')
    .map((block) => `${block.role}:${block.bbox.join(',')}`)
  console.log(pid, `p${page}`, 'blocks', result.blocks.length, 'regions', regions.join(' | '))
}
