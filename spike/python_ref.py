"""Reference extraction using the original paper-reflow-lab reflow.py + PyMuPDF."""

from __future__ import annotations

import json
import pathlib
import sys

sys.path.insert(0, r"D:\下载\paper-reflow-lab")

import fitz  # noqa: E402
from reflow import reflow_page  # noqa: E402


def main() -> None:
    for raw in sys.argv[1:]:
        file = pathlib.Path(raw)
        doc = fitz.open(file)
        out = {"file": file.name, "pages": []}
        for number in range(1, min(4, len(doc)) + 1):
            page = doc[number - 1]
            data = reflow_page(page, number)
            raw_text = page.get_text("text")
            out["pages"].append(
                {
                    "page": number,
                    "width": round(page.rect.width, 1),
                    "height": round(page.rect.height, 1),
                    "layout": data["layout"],
                    "raw_chars": len(raw_text.strip()),
                    "blocks": [
                        {"text": block["text"], "column": block["column"], "box": block["bbox"]}
                        for block in data["blocks"]
                        if block["kind"] == "text"
                    ],
                }
            )
        target = file.with_suffix(".py.json")
        target.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{file.name}: {len(out['pages'])} pages -> {target}")


if __name__ == "__main__":
    main()
