"""Compare pdf.js reflow (js.json) against the PyMuPDF reference (py.json)."""

from __future__ import annotations

import difflib
import json
import pathlib
import re
import sys

SPACE = re.compile(r"\s+")


def norm(text: str) -> str:
    return SPACE.sub(" ", text).strip()


def key(text: str) -> str:
    return re.sub(r"\s+", "", text.lower())[:40]


def main() -> None:
    for raw in sys.argv[1:]:
        file = pathlib.Path(raw)
        js = json.loads(file.with_suffix(".js.json").read_text(encoding="utf-8"))
        py = json.loads(file.with_suffix(".py.json").read_text(encoding="utf-8"))
        by_page_js = {p["page"]: p for p in js["pages"]}
        print(f"\n=== {file.name} ===")
        for page in py["pages"]:
            n = page["page"]
            jsp = by_page_js.get(n)
            if not jsp:
                continue
            py_blocks = [norm(b["text"]) for b in page["blocks"]]
            js_blocks = [norm(b["text"]) for b in jsp["blocks"]]
            py_text = " ".join(py_blocks)
            js_text = " ".join(js_blocks)
            flat_js = re.sub(r"\s+", "", js_text)
            ratio = difflib.SequenceMatcher(None, py_text, js_text, autojunk=False).ratio()
            flat_ratio = difflib.SequenceMatcher(None, re.sub(r"\s+", "", py_text), flat_js, autojunk=False).ratio()
            js_keys = {key(b): i for i, b in enumerate(js_blocks)}
            found = [(i, js_keys[key(b)]) for i, b in enumerate(py_blocks) if key(b) in js_keys]
            inversions = sum(1 for a in range(len(found)) for b in range(a + 1, len(found)) if found[a][1] > found[b][1])
            missing = [b for b in py_blocks if key(b) not in js_keys]
            print(
                f"p{n}: layout py={page['layout']} js={jsp['layout']} | blocks py={len(py_blocks)} js={len(js_blocks)}"
                f" | ratio={ratio:.3f} flat={flat_ratio:.3f} | matched={len(found)}/{len(py_blocks)} inv={inversions}"
            )
            if missing:
                print("   py-only sample:", " / ".join(m[:60] for m in missing[:2]))
            extra = [b for b in js_blocks if key(b) not in {key(p) for p in py_blocks}]
            if extra:
                print("   js-only sample:", " / ".join(m[:60] for m in extra[:2]))


if __name__ == "__main__":
    main()
