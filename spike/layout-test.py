import json
import sys

from paddleocr import LayoutDetection


def to_dict(result):
    data = result if isinstance(result, dict) else getattr(result, "json", None)
    if isinstance(data, str):
        data = json.loads(data)
    if not isinstance(data, dict):
        data = getattr(result, "__dict__", {})
    return data


def main():
    model_name = sys.argv[1] if len(sys.argv) > 1 else "PP-DocLayout-M"
    paths = sys.argv[2:]
    print("model", model_name, flush=True)
    model = LayoutDetection(model_name=model_name)
    for path in paths:
        print("==", path, flush=True)
        results = model.predict(path)
        boxes = []
        for result in results:
            data = to_dict(result)
            for box in data.get("boxes") or []:
                boxes.append(
                    {
                        "label": box.get("label") or box.get("cls_id"),
                        "score": box.get("score"),
                        "coordinate": [round(float(v), 1) for v in (box.get("coordinate") or [])],
                    }
                )
        for box in boxes:
            print(f"  {str(box['label']):20s} {box['coordinate']} score={box['score']}", flush=True)
        out = path.rsplit(".", 1)[0] + ".json"
        with open(out, "w", encoding="utf-8") as handle:
            json.dump({"image": path, "model": model_name, "boxes": boxes}, handle, ensure_ascii=False, indent=1)
        print("  ->", out, flush=True)


if __name__ == "__main__":
    main()
