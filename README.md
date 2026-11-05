# dsh-paper-reader

A right-sidebar paper reader for DSH (DeepSeek Harness): reflows two-column PDFs and web articles into a single reading stream, translates paragraph by paragraph with KaTeX formulas, and works side by side with the native chat.

一个 DSH 右侧栏论文阅读器：把双栏 PDF / 网页文章按阅读顺序重排，逐段翻译成中文（公式用 KaTeX 渲染），并与左侧原生对话联动。

## 功能

- **PDF 阅读**：双栏/单栏自动识别、阅读顺序重排、图片与表格按区域裁切、页码跳转、原页对照。
- **网页文章**：粘贴公开链接抓取正文，分节阅读；图片通过本地代理加载。
- **翻译**：逐段 / 整页 / 全文，中英对照；译文和原文公式都用 KaTeX 排版。
- **原文公式改写**（可选）：让模型把原文里的数学内容改写成 LaTeX 再渲染。
- **选区提问**：选中一段直接提问，问题注入当前会话；配合 `paper_read` / `paper_search` 工具和页码回跳。
- **笔记**：段级批注；可导出到 Obsidian 风格 vault 的 `sources/self/`，问答可转存 `sources/ai/`。
- **文献库**：文件夹、搜索、改名、删除；支持 arXiv / 网页 / 本地 PDF 入库。
- **每篇论文独立会话**：一键切换，聊天记录按论文隔离。

## 安装

需要已安装 DSH desktop（Web UI）。

```bash
cd dsh-paper-reader
pnpm install
```

然后在 DSH 中把本目录作为插件 bundle 安装（例如用 `plugin_manager` 的 `install_bundle` 指向本目录，或把本目录 `link:` 进 profile 的 `dependencies`）。重启 DSH 后，右侧栏会出现「论文阅读」页签。

本插件不修改 DSH 本体；Host 通过 `ctx` 注册 HTTP 路由和工具，Client 通过公开的 slots / 服务接入。

## 配置

在 profile 的 `cordis.patch.yml` 里按插件 id `paper-reflow` 覆盖配置：

```yaml
- id: paper-reflow
  config:
    vaultDir: D:\paper-vault  # 可选：知识库根目录
    dataDir: D:\paper-reader   # 可选：文献库数据目录
```

- `vaultDir`：配置后，笔记导出到 `<vaultDir>/sources/self/`，问答导出到 `<vaultDir>/sources/ai/`；不配置则不写任何文件。
- `dataDir`：默认 `%LOCALAPPDATA%\dsh-paper-reader`（首次启动会尝试把旧的 `dsh-paper-reflow` 目录迁移过来）。

## 使用

1. 右侧栏打开「论文阅读」→「上传」选 PDF，或粘贴 arXiv / 网页链接。
2. 顶部可切换页码、自动/双栏/单栏、字号、宋体/黑体、原页。
3. 「原文 / 对照 / 译文」切换阅读模式；「译本页」「译全文」调用模型；「公式」改写原文数学内容。
4. 选中正文 → 「问这段 / 记笔记 / 复制」。
5. 笔记面板可「导出到知识库」；提问后可用「存问答」把最近一轮问答写入 `sources/ai`。

快捷键：`←` / `→` 翻页；`Esc` 关闭浮层。

## 结构

```
index.js       Host：HTTP 路由、文献库存储、翻译/公式、笔记与问答导出、工具注册
engine.mjs     PDF 解析：文本行重建、分栏检测、段落切分、表格/图片区域、阅读顺序
client.js      阅读器 UI：slots 注册、工具栏、选区交互、笔记/文献库、KaTeX 渲染
locale/        侧边栏标题与描述
icon.svg       插件图标
```

Host 的 HTTP 路由统一挂在 `/paper-reflow/*` 下，并用 `connection.requestRejection(req)` 做鉴权。

## 已知限制

- 版面分析是启发式的：扫描件（无文本层）、复杂合并单元格、竖排文字不支持。
- 网页只提取 HTML 正文；纯 JS 渲染、登录后可见的页面可能抓不到；只取 `<img>`，不含 CSS 背景图。
- Node 的 `fetch` 不走系统代理，被墙站点会失败。
- SSRF 防护只覆盖常见内网地址段，不防 DNS rebinding；建议只在本机使用。
- 翻译和公式改写使用 DSH 的默认模型，效果取决于模型。
- 首次打开较大的 PDF 会逐页解析，稍慢；解析结果有缓存。
- 界面文案目前以中文为主；`locale/` 里的侧边栏标题有中英两份。

## 开发

```bash
pnpm install
node --check index.js && node --check client.js && node --check engine.mjs
node spike/host-test.mjs   # 需要 spike/fixtures/ 里的测试 PDF
```

`spike/` 下是开发期的脚本和对照实验；测试用 PDF 和生成的图片不入库（见 `spike/fixtures/README.md`）。

## License

[MIT](./LICENSE)
