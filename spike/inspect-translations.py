import json
import sys

path = r"C:\Users\31561\AppData\Local\dsh-paper-reflow\papers\468cf47e7ce0\translations.json"
data = json.load(open(path, encoding="utf-8"))
items = data["items"]
print("count", len(items))
with_dollar = [(key, value["text"]) for key, value in items.items() if "$" in value["text"]]
print("with dollar", len(with_dollar))
for key, text in with_dollar[:3]:
    print("---", key)
    print(text[:400])
without = [(key, value["text"]) for key, value in items.items() if "$" not in value["text"]]
print("without dollar sample:")
for key, text in without[:2]:
    print("---", key)
    print(text[:300])
