import json
import sys

from PIL import Image, ImageDraw

image_path, json_path, out_path = sys.argv[1:4]
data = json.load(open(json_path, encoding="utf-8"))
image = Image.open(image_path).convert("RGB")
draw = ImageDraw.Draw(image)
for box in data.get("boxes", []):
    coordinate = box.get("coordinate") or []
    if len(coordinate) != 4:
        continue
    x0, y0, x1, y1 = coordinate
    draw.rectangle([x0, y0, x1, y1], outline=(230, 40, 40), width=4)
    draw.text((x0 + 6, y0 + 4), f"{box.get('label')} {box.get('score', 0):.2f}", fill=(230, 40, 40))
image.save(out_path)
print("saved", out_path)
