# PaperFlow

![CI](https://github.com/PowerTrue212/dsh-paperflow/actions/workflows/ci.yml/badge.svg)

**让英文论文更容易读，让 AI 随时参与思考。**

一个为 DeepSeek Harness（DSH）打造的论文阅读插件。仓库与包名：`dsh-paperflow`。

读英文论文时，我们往往希望先用中文快速理解文章，再回到原文核对细节；遇到难懂的概念、公式或实验设计，又希望随时向 AI 提问。

PaperFlow 希望把这些事情放在同一个地方完成。

![PaperFlow](docs/assets/hero.png)

*左侧与 AI 对话，右侧阅读论文。不必反复切换窗口，也不必手动复制大段上下文。*

<!-- 演示 GIF 待补：docs/assets/demo.gif -->

## 读得更轻松

PaperFlow 将 PDF 中的双栏文本重新整理为连续的阅读内容，并逐段翻译成中文。

你可以直接阅读译文，也可以保留中英对照，随时核对原文。公式使用 KaTeX 排版，图片和图表尽可能保留原有结构，让论文读起来更像一篇正常的文章，而不是一份难以浏览的 PDF。

![中英对照与公式排版](docs/assets/figure.png)

## 边读，边问

阅读过程中遇到不理解的内容？直接选中段落，向左侧的 DSH 提问。

AI 还可以通过 `paper_read` 和 `paper_search` 读取、搜索论文内容。论文与对话保持在同一个工作区，每篇论文也可以拥有独立的会话。

除了 PDF，PaperFlow 也支持导入 arXiv 和网页文章，保存段落笔记，并将内容导出到本地知识库。

## 功能一览

- **PDF 重排**：双栏/单栏自动识别，按阅读顺序输出连续文本；表格与插图按区域裁切。
- **中英对照**：原文 / 对照 / 译文三种模式，逐段、整页或全文翻译，公式用 KaTeX 排版。
- **选区提问**：选中即问，问题带原文和页码注入当前会话；配合 `paper_read` / `paper_search` 与页码回跳。
- **笔记与导出**：段级批注保存到本地，可导出为 `sources/self/` 下的 Markdown；问答可转存 `sources/ai/`。
- **文献库**：文件夹、搜索、改名、删除；支持本地 PDF、arXiv、网页文章入库。
- **独立会话**：每篇论文一个会话，聊天记录随论文隔离。
- **本地版面模型（可选）**：PaddleOCR 找整图/表格外框，多张小图拼成的插图也能整张提取；不需要 API Key。

## 安装

需要已安装 DSH Desktop（Web UI）。

```bash
cd dsh-paperflow
pnpm install
```

通过 DSH 的 `plugin_manager` 使用 `install_bundle` 将本目录安装为插件，或通过 `link:` 添加至当前 profile 的 `dependencies`。

重启 DSH 后，在右侧栏打开「论文阅读」即可使用。

翻译走 DSH 的默认模型，请先在 DSH 里配置好可用的模型；插件本身不需要额外 API Key。

## 配置

在 profile 的 `cordis.patch.yml` 里按插件 id `paper-reflow` 覆盖配置：

```yaml
- id: paper-reflow
  config:
    vaultDir: D:\paper-vault  # 可选：知识库根目录
    dataDir: D:\paper-reader  # 可选：文献库数据目录
    layout:                   # 可选：本地版面模型
      enabled: false
      python: C:\Python312\python.exe
      model: PP-DocLayout-M
```

- `vaultDir`：配置后，笔记导出到 `<vaultDir>/sources/self/`，问答导出到 `<vaultDir>/sources/ai/`；不配置则不写任何文件。
- `dataDir`：默认 `%LOCALAPPDATA%\dsh-paperflow`（首次启动会把旧的 `dsh-paper-reflow` / `dsh-paper-reader` 目录迁移过来）。
- `layout`：可选，开启后用本地 PaddleOCR 版面模型找整图/表格外框（见下）。

## 本地版面模型（可选）

默认关闭。开启后，Host 会把每页渲染成 2x PNG，交给本机 Python 的
[PaddleOCR LayoutDetection](https://www.paddleocr.ai/main/en/version3.x/module_usage/layout_detection.html)
找 `figure` / `table` 外框，再把归一化坐标映射回 PDF 点裁剪。这样由多张小图、
箭头和文字拼成的整图也能作为一张图提取；图注保留为文本。

建议用 python.org 的 3.12/3.13 建独立 venv（Anaconda 的 DLL 环境可能和 Paddle 冲突）：

```powershell
.\layout\setup.ps1 -Python C:\Python312\python.exe
```

脚本会创建 `.venv-layout`、安装 `paddlepaddle` / `paddleocr` 并验证 import。之后把
`layout.enabled` 设为 `true`，`layout.python` 指向 `.venv-layout\Scripts\python.exe`。

模型在首次推理时自动下载（M ≈ 23 MB，L ≈ 124 MB），之后可离线使用；不需要 API Key，不按页计费。
如果解释器/模型不可用，插件会退回到内置启发式，并在控制台提示一次。

第一次打开一篇论文时，Host 会在后台把其余页面依次跑一遍，结果写进 `papers/<id>/layout.json`；
之后翻页直接读缓存，不再等模型。可以把它理解成“开头慢一次，后面都快”。

## 已知限制

- 默认启发式版面分析不支持扫描件（无文本层）、复杂合并单元格和竖排文字；开启版面模型后由模型给整图/表格框，模型漏检的页不会再回退启发式。
- 网页只提取 HTML 正文；纯 JavaScript 渲染或需要登录的页面可能抓不到；只取 `<img>`，不含 CSS 背景图。
- Node 的 `fetch` 不走系统代理，被墙站点会失败。
- SSRF 防护只覆盖常见内网地址段，不防 DNS rebinding；建议只在本机可信环境使用。
- 翻译和公式改写使用 DSH 的默认模型，效果取决于模型；首次打开较大的 PDF 会逐页解析，稍慢。

## 开发

```bash
pnpm install
pnpm check   # node --check：index / client / engine / layout
pnpm test    # 合成 PDF 的烟雾测试（上传、取页、文献库、笔记）
```

CI（GitHub Actions）在 Ubuntu + Node 24 上跑 `pnpm check` 和 `pnpm test`；测试用的
`spike/fixtures/smoke.pdf` 是脚本生成的合成 PDF，不含第三方论文。

`spike/` 下还有开发期的对照实验和版面模型测试；真实论文的 PDF 和生成的图片不入库（见 `spike/README.md`）。

## License

[MIT](./LICENSE)

版本记录见 [CHANGELOG.md](./CHANGELOG.md)。
