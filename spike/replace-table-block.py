import re

path = r"E:\program\dsh-paper-reflow\engine.mjs"
text = open(path, encoding="utf-8").read()

start = text.index("  // Broader table heuristic:")
end = text.index("  regions.sort((a, b) => a.bbox[1] - b.bbox[1])")
new_block = '''  // Caption-anchored tables: collect the contiguous block of short rows
  // immediately above a "Table N" caption and crop it as one image.
  const captionRows = rowList.filter((row) => /^(table|\\u8868)\\s*\\d+/i.test(row.text.trim()))
  for (const caption of captionRows) {
    const index = rowList.indexOf(caption)
    const collected = []
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const row = rowList[cursor]
      if (row.y1 > caption.y0 - 1) continue
      const previous = collected[collected.length - 1]
      const gap = previous ? previous.y0 - row.y1 : caption.y0 - row.y1
      if (gap > 32) break
      const text = row.text.trim()
      if (text.length > 120 || /[.\\u3002!?]$/.test(text)) break
      collected.push(row)
    }
    if (collected.length < 4) continue
    const numeric = collected.filter((row) => /\\d/.test(row.text)).length
    if (numeric < 2) continue
    const y0 = Math.min(...collected.map((row) => row.y0))
    const x0 = Math.min(...collected.map((row) => row.x0), caption.x0)
    const x1 = Math.max(...collected.map((row) => row.x1), caption.x1)
    if (x1 - x0 < 120 || caption.y0 - y0 < 30) continue
    regions.push({
      role: 'table',
      bbox: [
        Math.max(0, x0 - 4),
        Math.max(0, y0 - 4),
        Math.min(width, x1 + 4),
        Math.min(height, caption.y0 + 2),
      ].map((value) => Math.round(value * 10) / 10),
    })
  }

'''
text = text[:start] + new_block + text[end:]
open(path, "w", encoding="utf-8").write(text)
print("replaced", start, end)
