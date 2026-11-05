import json
import os
import sys

os.environ.setdefault("FLAGS_use_mkldnn", "0")
os.environ.setdefault("FLAGS_use_onednn", "0")

from paddleocr import LayoutDetection  # noqa: E402

MODEL = os.environ.get("LAYOUT_MODEL", "PP-DocLayout-M")


def result_boxes(result):
    data = result if isinstance(result, dict) else getattr(result, "json", None)
    if isinstance(data, str):
        data = json.loads(data)
    if not isinstance(data, dict):
        data = getattr(result, "__dict__", {})
    boxes = []
    for box in data.get("boxes") or []:
        coordinate = box.get("coordinate") or []
        if len(coordinate) != 4:
            continue
        boxes.append(
            {
                "label": box.get("label"),
                "score": box.get("score"),
                "coordinate": [round(float(value), 1) for value in coordinate],
            }
        )
    return boxes


def main():
    try:
        model = LayoutDetection(model_name=MODEL, enable_mkldnn=False)
    except TypeError:
        model = LayoutDetection(model_name=MODEL)
    for path in sys.argv[1:]:
        boxes = []
        for result in model.predict(path):
            boxes.extend(result_boxes(result))
        out = path.rsplit(".", 1)[0] + ".json"
        with open(out, "w", encoding="utf-8") as handle:
            json.dump({"image": path, "model": MODEL, "boxes": boxes}, handle, ensure_ascii=False, indent=1)
        print(f"{path}: {len(boxes)} boxes", flush=True)
        for box in boxes:
            print(f"  {box['label']:18s} {box['coordinate']} {box['score']:.2f}", flush=True)


if __name__ == "__main__":
    main()
