import fs from 'node:fs'

import { layoutRegions } from '../layout.mjs'

const pages = [
  ['resnet-p1', 612, 792],
  ['resnet-p2', 612, 792],
  ['resnet-p4', 612, 792],
  ['t2j-p9', 595.5, 842],
  ['t2j-p10', 595.5, 842],
  ['t2j-p11', 595.5, 842],
]

for (const [name, width, height] of pages) {
  const data = JSON.parse(fs.readFileSync(`spike/fixtures/layout/${name}.json`, 'utf8'))
  const imageWidth = name.startsWith('resnet') ? 1224 : 1191
  const imageHeight = name.startsWith('resnet') ? 1584 : 1684
  const boxes = data.boxes.map((box) => ({
    label: box.label,
    x0: box.coordinate[0] / imageWidth,
    y0: box.coordinate[1] / imageHeight,
    x1: box.coordinate[2] / imageWidth,
    y1: box.coordinate[3] / imageHeight,
  }))
  const regions = layoutRegions(boxes, width, height)
  console.log(name, regions.map((region) => `${region.role}:${region.bbox.map((v) => Math.round(v)).join(',')}`).join(' | '))
}
