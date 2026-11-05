# Changelog

## 0.1.0 — 2026-11-05

首个公开版本。

### 功能

- 右侧栏「论文阅读」：PDF / 网页文章按阅读顺序重排，原文 / 对照 / 译文三种模式，KaTeX 公式，整图与表格区域裁切，页码跳转与原页对照。
- 逐段 / 整页 / 全文翻译，走 DSH 默认模型；可选的原文公式改写。
- 选区提问：问题注入当前会话，配合 `paper_read` / `paper_search` 工具和页码回跳。
- 笔记导出到 `sources/self/`，问答转存 `sources/ai/`。
- 文献库：文件夹、搜索、改名、删除；arXiv / 网页 / 本地 PDF 入库。
- 每篇论文独立会话。
- 可选本地版面模型（PaddleOCR `PP-DocLayout-M`）：整图 / 表格外框、图注配对、双栏判定，每篇论文后台扫描并缓存。

### 工程

- MIT License。
- README 截图与简体中文文档。
- GitHub Actions 烟雾测试（合成 PDF，不依赖外部论文）。
- `layout/setup.ps1` 一键创建 PaddleOCR venv。
