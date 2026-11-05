import json
import os
import re

base = os.path.join(os.environ["LOCALAPPDATA"], "dsh-paper-reflow")
index = json.load(open(os.path.join(base, "index.json"), encoding="utf-8"))
papers = {paper["id"]: paper for paper in index["papers"]}
vault_dir = r"D:\MY_BRAIN\sources\self"
os.makedirs(vault_dir, exist_ok=True)


def slugify(title: str) -> str:
    slug = re.sub(r"[\W_]+", "-", title.lower(), flags=re.UNICODE).strip("-")
    return slug[:60] or "paper"


for paper_id, paper in papers.items():
    notes_path = os.path.join(base, "papers", paper_id, "notes.json")
    if not os.path.exists(notes_path):
        continue
    data = json.load(open(notes_path, encoding="utf-8"))
    notes = [note for note in data.get("notes", []) if str(note.get("text") or "").strip()]
    if not notes:
        continue
    date = "2026-11-04"
    base_name = f"{date}-{slugify(paper['title'])}"
    target = os.path.join(vault_dir, f"{base_name}.md")
    suffix = 2
    while os.path.exists(target):
        target = os.path.join(vault_dir, f"{base_name}-{suffix}.md")
        suffix += 1
    lines = [
        "---",
        "author: self",
        f'title: {json.dumps(paper["title"], ensure_ascii=False)}',
        f'paper: {json.dumps(paper["title"], ensure_ascii=False)}',
        f'source: {paper.get("sourceUrl") or "local pdf"}',
        f"exported: {date}",
        "---",
        "",
        f'# {paper["title"]} 阅读批注',
        "",
    ]
    for note in notes:
        lines.extend([f'## 第 {note.get("page")} 页', ""])
        quote = str(note.get("quote") or "").replace("\n", " ")
        if quote:
            lines.extend([f"> {quote}", ""])
        lines.extend([str(note.get("text") or "").strip(), ""])
    open(target, "w", encoding="utf-8", newline="\n").write("\n".join(lines) + "\n")
    print("wrote", target, "notes", len(notes))
