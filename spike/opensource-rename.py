import json
import re
from pathlib import Path

root = Path(r"E:\program\dsh-paper-reflow")

# ---------------- index.js ----------------
index = root / "index.js"
s = index.read_text(encoding="utf-8")

s = s.replace(
    "import crypto from 'node:crypto'\nimport fs from 'node:fs/promises'",
    "import crypto from 'node:crypto'\nimport fsSync from 'node:fs'\nimport fs from 'node:fs/promises'",
)

s = s.replace(
    """  const base = config?.dataDir
    ? path.resolve(String(config.dataDir))
    : path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'dsh-paper-reflow')""",
    """  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const defaultBase = path.join(localAppData, 'dsh-paper-reader')
  const legacyBase = path.join(localAppData, 'dsh-paper-reflow')
  if (!config?.dataDir && !fsSync.existsSync(defaultBase) && fsSync.existsSync(legacyBase)) {
    try {
      fsSync.renameSync(legacyBase, defaultBase)
    } catch {
      /* keep using the legacy directory when it is locked */
    }
  }
  const base = config?.dataDir
    ? path.resolve(String(config.dataDir))
    : fsSync.existsSync(defaultBase)
      ? defaultBase
      : legacyBase""",
)

s = s.replace(
    "const vault = config?.vaultDir ? path.resolve(String(config.vaultDir)) : 'D:\\\\MY_BRAIN'\n    const dir = path.join(vault, 'sources', 'self')",
    "const vault = config?.vaultDir ? path.resolve(String(config.vaultDir)) : ''\n    if (!vault) throw new Error('未配置知识库路径（vaultDir）。')\n    const dir = path.join(vault, 'sources', 'self')",
)
s = s.replace(
    "const vault = config?.vaultDir ? path.resolve(String(config.vaultDir)) : 'D:\\\\MY_BRAIN'\n    const dir = path.join(vault, 'sources', 'ai')",
    "const vault = config?.vaultDir ? path.resolve(String(config.vaultDir)) : ''\n    if (!vault) return fail(res, 400, '未配置知识库路径（vaultDir），请在插件设置里填写。')\n    const dir = path.join(vault, 'sources', 'ai')",
)

s = s.replace("name: '@local/dsh-paper-reflow'", "name: 'dsh-paper-reader'")
s = s.replace("Mozilla/5.0 dsh-paper-reflow", "Mozilla/5.0 dsh-paper-reader")
s = s.replace("论文重排", "论文阅读")
s = s.replace("Paper Reflow bundle", "Paper Reader bundle")
s = s.replace("  * Host half of the Paper Reflow bundle.", "  * Host half of the dsh-paper-reader bundle.")
index.write_text(s, encoding="utf-8")
print("index.js patched", s.count("dsh-paper-reader"), "reader refs")

# ---------------- client.js ----------------
client = root / "client.js"
c = client.read_text(encoding="utf-8")
c = c.replace("id: '@local/dsh-paper-reflow'", "id: 'dsh-paper-reader'")
c = c.replace("论文重排", "论文阅读")
client.write_text(c, encoding="utf-8")
print("client.js patched", c.count("论文阅读"), "reader labels")

# ---------------- locale ----------------
zh = {
    "meta": {
        "title": "论文阅读",
        "description": "在右侧栏按阅读顺序重排双栏 PDF 与网页正文，逐段中英对照，并与原生对话并排。",
    }
}
(root / "locale" / "zh.json").write_text(json.dumps(zh, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
en = {
    "meta": {
        "title": "Paper Reader",
        "description": "Read two-column PDFs and web articles in a reflowed, bilingual reading stream beside the native chat.",
    }
}
(root / "locale" / "en.json").write_text(json.dumps(en, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# ---------------- package.json ----------------
package = json.loads((root / "package.json").read_text(encoding="utf-8"))
package["name"] = "dsh-paper-reader"
package["description"] = "Paper reader panel for DSH: reflowed, bilingual reading of two-column PDFs and web articles beside the native chat."
package["license"] = "MIT"
package["keywords"] = ["dsh", "dsh-plugin", "pdf", "paper", "reader", "translation", "katex"]
package.pop("private", None)
package["files"] = [
    "index.js",
    "client.js",
    "engine.mjs",
    "cordis.patch.yml",
    "locale/*.json",
    "icon.svg",
    "README.md",
    "LICENSE",
]
(root / "package.json").write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# ---------------- cordis patch ----------------
patch = root / "cordis.patch.yml"
p = patch.read_text(encoding="utf-8")
p = p.replace("@local/dsh-paper-reflow", "dsh-paper-reader")
patch.write_text(p, encoding="utf-8")
print("done")
