"""PaddleOCR layout worker for dsh-paperflow.

Reads JSON lines on stdin, writes JSON lines on stdout.

Request:  {"id": "...", "image": "<base64 png>", "width": 1224, "height": 1584}
Response: {"id": "...", "boxes": [{"label": "figure", "score": 0.98,
                                   "x0": 0.05, "y0": 0.2, "x1": 0.6, "y1": 0.8}]}

Coordinates are normalized to 0..1 so the host can map them to PDF points with
the same page image it rendered. Model downloads and caching are handled by
PaddleOCR; the model is loaded once per worker process.
"""

import base64
import json
import os
import sys
import tempfile

from paddleocr import LayoutDetection

MODEL = os.environ.get("LAYOUT_MODEL", "PP-DocLayout-M")


def main():
    model = LayoutDetection(model_name=MODEL)
    model_ready = True
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue
        if request.get("cmd") == "quit":
            break
        request_id = request.get("id")
        try:
            width = int(request.get("width") or 0)
            height = int(request.get("height") or 0)
            if not width or not height:
                raise ValueError("missing image size")
            image = base64.b64decode(request["image"])
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as handle:
                handle.write(image)
                path = handle.name
            try:
                results = model.predict(path)
            finally:
                try:
                    os.unlink(path)
                except OSError:
                    pass
            boxes = []
            for result in results:
                data = result if isinstance(result, dict) else getattr(result, "json", None)
                if isinstance(data, str):
                    data = json.loads(data)
                if not isinstance(data, dict):
                    data = getattr(result, "__dict__", {})
                for box in data.get("boxes") or []:
                    coordinate = box.get("coordinate") or box.get("bbox") or []
                    if len(coordinate) != 4:
                        continue
                    x0, y0, x1, y1 = [float(value) for value in coordinate]
                    x0, x1 = sorted((x0, x1))
                    y0, y1 = sorted((y0, y1))
                    boxes.append(
                        {
                            "label": str(box.get("label") or box.get("cls_id") or ""),
                            "score": float(box.get("score") or 0),
                            "x0": max(0.0, min(1.0, x0 / width)),
                            "y0": max(0.0, min(1.0, y0 / height)),
                            "x1": max(0.0, min(1.0, x1 / width)),
                            "y1": max(0.0, min(1.0, y1 / height)),
                        }
                    )
            sys.stdout.write(json.dumps({"id": request_id, "boxes": boxes}, ensure_ascii=False) + "\n")
            sys.stdout.flush()
        except Exception as error:  # keep the worker alive for the next page
            sys.stdout.write(
                json.dumps({"id": request_id, "error": f"{type(error).__name__}: {error}"}) + "\n"
            )
            sys.stdout.flush()


def warmup():
    # Importing Paddle is the slow part; load the model before the first page.
    if not os.environ.get("LAYOUT_NO_WARMUP"):
        try:
            from paddleocr import LayoutDetection as _LayoutDetection  # noqa: F401
        except Exception:
            pass


if __name__ == "__main__":
    warmup()
    main()
