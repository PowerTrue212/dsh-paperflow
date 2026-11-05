import readline from 'node:readline'

const rl = readline.createInterface({ input: process.stdin })

rl.on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message.cmd === 'quit') process.exit(0)
  const boxes = [
    { label: 'figure', score: 0.99, x0: 41 / 612, y0: 71 / 792, x1: 307 / 612, y1: 626 / 792 },
    { label: 'figure_caption', score: 0.99, x0: 41 / 612, y0: 630 / 792, x1: 560 / 612, y1: 700 / 792 },
    { label: 'figure', score: 0.97, x0: 310 / 612, y0: 80 / 792, x1: 540 / 612, y1: 300 / 792 },
    { label: 'figure', score: 0.96, x0: 312 / 612, y0: 305 / 792, x1: 538 / 612, y1: 500 / 792 },
    { label: 'table', score: 0.98, x0: 50 / 612, y0: 700 / 792, x1: 560 / 612, y1: 780 / 792 },
  ]
  process.stdout.write(`${JSON.stringify({ id: message.id, boxes })}\n`)
})
