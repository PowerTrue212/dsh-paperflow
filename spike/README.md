# spike

Development scratch space: extraction experiments, layout regression checks, and a mock-host smoke test. Nothing here is required at runtime.

## Smoke test

```bash
pnpm install
node spike/host-test.mjs
```

`host-test.mjs` builds a mock DSH context (fake LLM, sessions, tools, web server) and exercises upload, page reflow, translation, notes, Q&A export, folders, formulas, and URL ingestion.

It needs test PDFs in `spike/fixtures/` (not committed). Put public papers there, e.g.:

- `resnet.pdf` — Deep Residual Learning for Image Recognition (arXiv:1512.03385)
- `attention.pdf` — Attention Is All You Need (arXiv:1706.03762)
- `gpt3.pdf` — Language Models are Few-Shot Learners (arXiv:2005.14165)

Any of these can be downloaded from arXiv; generated images and `.test-data/` are ignored by git.

## Other scripts

- `engine-test.mjs` / `regions.mjs` — inspect reflow blocks and table/figure regions for one page.
- `extract.mjs` / `compare.py` / `python_ref.py` — compare the JS reflow against a Python reference implementation.
- `render-test.mjs` — render a page/figure crop to PNG.
- Scratch scripts with dates or one-off names may be stale; treat them as notes, not tests.
