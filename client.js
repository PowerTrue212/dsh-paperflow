window.__ModuleLoader__.load({
  id: 'dsh-paper-reader',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React
    const TAB_ID = 'paper-reflow'
    const STORAGE_KEY = 'paper-reflow:current'
    const FONT_KEY = 'paper-reflow:font'
    const FONT_MODE_KEY = 'paper-reflow:font-mode'
    const MIN_FONT = 14
    const MAX_FONT = 22

    const CSS = `
      .pr-root {
        position: relative;
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        font-size: var(--pr-font, 16px);
        line-height: 1.85;
        outline: none;
      }
      .pr-bar {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px 10px;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-layer-1);
        flex: none;
      }
      .pr-row { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
      .pr-title {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        font-weight: 600;
        line-height: 1.4;
      }
      .pr-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
      .pr-btn {
        font: inherit;
        font-size: 12px;
        line-height: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        height: 26px;
        min-width: 26px;
        padding: 0 7px;
        border-radius: 6px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: transparent;
        color: var(--dsw-alias-label-primary);
        cursor: pointer;
      }
      .pr-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
      .pr-btn:disabled { opacity: 0.45; cursor: default; }
      .pr-btn.active { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
      .pr-select {
        font: inherit;
        font-size: 12px;
        height: 26px;
        border-radius: 6px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: transparent;
        color: var(--dsw-alias-label-primary);
        padding: 0 4px;
      }
      .pr-body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 26px clamp(16px, 4vw, 44px) 72px;
        font-family: "Source Serif 4", "Iowan Old Style", Charter, Georgia, "Noto Serif SC", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "SimSun", serif;
        font-feature-settings: "kern" 1, "liga" 1;
      }
      .pr-root.pr-sans .pr-body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      .pr-inner { max-width: 46em; margin: 0 auto; }
      .pr-body.loading { opacity: 0.55; }
      .pr-h1 {
        font-family: inherit;
        font-size: calc(var(--pr-font, 16px) * 1.5);
        line-height: 1.34;
        font-weight: 400;
        letter-spacing: 0;
        margin: 10px 0 22px;
      }
      .pr-h2 {
        font-family: inherit;
        font-size: calc(var(--pr-font, 16px) * 1.18);
        line-height: 1.45;
        font-weight: 400;
        letter-spacing: 0;
        margin: 30px 0 12px;
      }
      .pr-h3 {
        font-family: inherit;
        font-size: calc(var(--pr-font, 16px) * 1.04);
        line-height: 1.55;
        font-weight: 400;
        letter-spacing: 0.01em;
        margin: 22px 0 8px;
      }
      .pr-p { margin: 0 0 1.05em; text-align: left; line-height: 1.72; text-wrap: pretty; }
      .pr-p, .pr-h1, .pr-h2, .pr-h3 { overflow-wrap: break-word; }
      .pr-translation {
        margin: -0.45em 0 1.15em;
        padding: 0.2em 0.5em 0.2em 0.85em;
        border-left: 2px solid var(--dsw-alias-brand-primary);
        color: var(--dsw-alias-label-primary);
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 5%, transparent);
        border-radius: 0 6px 6px 0;
        font-size: 0.97em;
        line-height: 1.68;
      }
      .pr-translation .katex { font-size: 1.06em; }
      .pr-translation .katex-display { margin: 0.45em 0; }
      .pr-figure { margin: 18px 0 20px; text-align: center; }
      .pr-figure img {
        max-width: 100%;
        height: auto;
        border-radius: 6px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: #fff;
      }
      .pr-note { font-size: 10.5px; color: var(--dsw-alias-label-secondary); margin: 0 0 14px; line-height: 1.5; }
      .pr-empty { padding: 34px 18px; text-align: center; color: var(--dsw-alias-label-secondary); }
      .pr-drop {
        margin: 14px 0 22px;
        padding: 26px 18px;
        border: 1px dashed var(--dsw-alias-border-l2);
        border-radius: 10px;
        text-align: center;
        cursor: pointer;
        background: var(--dsw-alias-bg-layer-1);
      }
      .pr-drop.over { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); }
      .pr-drop strong { display: block; color: var(--dsw-alias-label-primary); font-size: 13px; margin-bottom: 4px; }
      .pr-drop span { font-size: 11px; }
      .pr-url { display: flex; gap: 6px; margin: -10px 0 16px; }
      .pr-url input {
        flex: 1;
        min-width: 0;
        height: 28px;
        font: inherit;
        font-size: 12px;
        padding: 0 8px;
        border-radius: 6px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: transparent;
        color: inherit;
      }
      .pr-folders { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; }
      .pr-search { margin: 0 0 12px; }
      .pr-search input {
        width: 100%;
        height: 28px;
        font: inherit;
        font-size: 12px;
        padding: 0 8px;
        border-radius: 6px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: transparent;
        color: inherit;
      }
      .pr-list { list-style: none; margin: 0; padding: 0; }
      .pr-item {
        display: flex;
        align-items: baseline;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 8px;
        cursor: pointer;
        border: 1px solid transparent;
      }
      .pr-item:hover { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l1); }
      .pr-item-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
      .pr-item-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
      .pr-section { font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--dsw-alias-label-secondary); margin: 0 0 8px; }
      .pr-banner {
        margin: 8px 10px 0;
        padding: 7px 10px;
        border-radius: 6px;
        font-size: 12px;
        line-height: 1.5;
        color: var(--dsw-alias-state-error-primary);
        border: 1px solid var(--dsw-alias-state-error-primary);
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
      }
      .pr-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); padding: 0 2px 10px; }
      .pr-footer {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 12px;
        border-top: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-layer-1);
        font-size: 11px;
        color: var(--dsw-alias-label-secondary);
      }
      .pr-overlay {
        position: absolute;
        inset: 0;
        z-index: 8;
        background: color-mix(in srgb, #000 55%, transparent);
        overflow: auto;
        padding: 14px;
        display: flex;
        justify-content: center;
        align-items: flex-start;
      }
      .pr-overlay img {
        max-width: 100%;
        height: auto;
        background: #fff;
        box-shadow: 0 10px 34px rgba(0, 0, 0, 0.35);
      }
      .pr-overlay-hint {
        position: fixed;
        bottom: 16px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 11px;
        color: #fff;
        opacity: 0.8;
      }
      .pr-sel {
        position: absolute;
        z-index: 9;
        width: 340px;
        max-width: calc(100% - 16px);
        padding: 8px;
        border-radius: 10px;
        border: 1px solid var(--dsw-alias-border-l2);
        background: var(--dsw-alias-bg-overlay);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .pr-sel-quote {
        font-size: 11px;
        line-height: 1.5;
        color: var(--dsw-alias-label-secondary);
        max-height: 48px;
        overflow: hidden;
        border-left: 2px solid var(--dsw-alias-border-l2);
        padding-left: 6px;
      }
      .pr-sel-row { display: flex; gap: 6px; align-items: center; }
      .pr-sel input {
        flex: 1;
        min-width: 0;
        font: inherit;
        font-size: 12px;
        height: 28px;
        padding: 0 8px;
        border-radius: 6px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: transparent;
        color: inherit;
      }
      .pr-sel textarea {
        width: 100%;
        min-height: 54px;
        max-height: 132px;
        resize: vertical;
        font: inherit;
        font-size: 12px;
        line-height: 1.55;
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: transparent;
        color: inherit;
        box-sizing: border-box;
      }
      .pr-overlay.center { align-items: center; }
      .pr-note-editor {
        width: min(560px, 94%);
        padding: 14px;
        border-radius: 12px;
        background: var(--dsw-alias-bg-overlay);
        border: 1px solid var(--dsw-alias-border-l2);
        display: flex;
        flex-direction: column;
        gap: 10px;
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.3);
      }
      .pr-note-editor textarea {
        min-height: 120px;
        resize: vertical;
        font: inherit;
        font-size: 13px;
        line-height: 1.6;
        padding: 8px;
        border-radius: 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: transparent;
        color: inherit;
      }
      .pr-note-editor input {
        height: 30px;
        font: inherit;
        font-size: 13px;
        padding: 0 8px;
        border-radius: 6px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: transparent;
        color: inherit;
      }
      .pr-notes-panel {
        width: min(640px, 94%);
        max-height: 82%;
        overflow: auto;
        padding: 14px;
        border-radius: 12px;
        background: var(--dsw-alias-bg-overlay);
        border: 1px solid var(--dsw-alias-border-l2);
        display: flex;
        flex-direction: column;
        gap: 10px;
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.3);
      }
      .pr-note-item { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12px; line-height: 1.6; }
      .pr-note-quote {
        color: var(--dsw-alias-label-secondary);
        border-left: 2px solid var(--dsw-alias-border-l2);
        padding-left: 6px;
      }
    `

    async function api(url, options) {
      const response = await fetch(url, options)
      const text = await response.text()
      let data = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = null
      }
      if (!response.ok) throw new Error((data && data.error) || `请求失败（${response.status}）`)
      return data
    }

    function formatDate(time) {
      if (!time) return ''
      const date = new Date(time)
      return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }

    function EmptyState(props) {
      const {
        papers,
        busy,
        dragging,
        onPick,
        onOpen,
        url,
        urlBusy,
        onUrl,
        onAddUrl,
        onRename,
        onDelete,
        deleteTarget,
        folders,
        activeFolder,
        onFolder,
        search,
        onSearch,
        onNewFolder,
        onDeleteFolder,
        deleteFolderTarget,
      } = props
      return h(
        'div',
        { className: 'pr-body' },
        h(
          'div',
          { className: 'pr-inner' },
          h(
            'div',
            {
              className: 'pr-drop' + (dragging ? ' over' : ''),
              role: 'button',
              tabIndex: 0,
              onClick: onPick,
              onKeyDown: (event) => {
                if (event.key === 'Enter' || event.key === ' ') onPick()
              },
            },
            h('strong', null, busy ? '正在打开…' : '把 PDF 拖到这里'),
            h('span', null, '或点击选择文件 · 双栏论文会按阅读顺序重排'),
          ),
          h(
            'form',
            {
              className: 'pr-url',
              onSubmit: (event) => {
                event.preventDefault()
                onAddUrl()
              },
            },
            h('input', {
              value: url,
              placeholder: '或粘贴 arXiv / 网页文章 / PDF 链接',
              onChange: (event) => onUrl(event.target.value),
            }),
            h(
              'button',
              { type: 'submit', className: 'pr-btn', disabled: urlBusy || !url.trim() },
              urlBusy ? '打开中…' : '打开链接',
            ),
          ),
          h('p', { className: 'pr-hint' }, '最多 40 MB / 250 页；PDF 与公开网页文章都可以直接打开，支持 arXiv 链接。'),
          h(
            'div',
            { className: 'pr-folders' },
            h(
              'button',
              {
                type: 'button',
                className: 'pr-btn' + (activeFolder === 'all' ? ' active' : ''),
                onClick: () => onFolder('all'),
              },
              '全部',
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'pr-btn' + (activeFolder === 'none' ? ' active' : ''),
                onClick: () => onFolder('none'),
              },
              '未分类',
            ),
            folders.map((folder) =>
              h(
                'button',
                {
                  key: folder.id,
                  type: 'button',
                  className: 'pr-btn' + (activeFolder === folder.id ? ' active' : ''),
                  onClick: () => onFolder(folder.id),
                },
                folder.name,
              ),
            ),
            h('button', { type: 'button', className: 'pr-btn', onClick: onNewFolder }, '＋文件夹'),
            activeFolder !== 'all' && activeFolder !== 'none'
              ? h(
                  'button',
                  { type: 'button', className: 'pr-btn', onClick: onDeleteFolder },
                  deleteFolderTarget === activeFolder ? '确认删夹' : '删夹',
                )
              : null,
          ),
          h(
            'div',
            { className: 'pr-search' },
            h('input', {
              value: search,
              placeholder: '搜索标题或网址',
              onChange: (event) => onSearch(event.target.value),
            }),
          ),
          papers.length
            ? h(
                'div',
                null,
                h('div', { className: 'pr-section' }, '最近阅读'),
                h(
                  'ul',
                  { className: 'pr-list' },
                  papers.map((paper) =>
                    h(
                      'li',
                      { key: paper.id, className: 'pr-item', onClick: () => onOpen(paper), title: paper.title },
                      h('span', { className: 'pr-item-title' }, paper.title),
                      h('span', { className: 'pr-item-meta' }, `${paper.pages} 页 · ${formatDate(paper.updatedAt)}`),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'pr-btn',
                          onClick: (event) => {
                            event.stopPropagation()
                            onRename(paper)
                          },
                        },
                        '改',
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'pr-btn',
                          onClick: (event) => {
                            event.stopPropagation()
                            onDelete(paper)
                          },
                        },
                        deleteTarget === paper.id ? '确认' : '删',
                      ),
                    ),
                  ),
                ),
              )
            : h('div', { className: 'pr-empty' }, '还没有打开过论文。'),
        ),
      )
    }

    function Reader(props) {
      const {
        paper,
        page,
        pageNumber,
        mode,
        loading,
        fontSize,
        fontMode,
        view,
        translations,
        translationHtml,
        translating,
        translateStatus,
        formulaHtml,
        formulaOn,
        formulaBusy,
        onFormulas,
        onQa,
        onView,
        onFont,
        onFontMode,
        onTranslate,
        onTranslateAll,
        onStop,
        onBack,
        onPrev,
        onNext,
        onMode,
        onUpload,
        noteCount,
        onNotes,
        onSession,
      } = props
      const [preview, setPreview] = useState(false)
      const blocks = (page && page.blocks) || []
      const isWeb = paper.kind === 'web'
      const visible = blocks.filter((block) => block.role !== 'meta')
      const sizes = visible
        .filter((block) => block.kind !== 'image' && block.size > 0)
        .map((block) => block.size)
        .sort((a, b) => a - b)
      const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 10
      const body = visible.map((block, index) => {
        if (block.kind === 'image') {
          const source = block.src
            ? `/paper-reflow/paper/${paper.id}/web-image?src=${encodeURIComponent(block.src)}`
            : `/paper-reflow/paper/${paper.id}/figure/${pageNumber}.png?scale=2&box=${(block.bbox || []).join(',')}`
          return h(
            'figure',
            { key: block.id || index, className: 'pr-figure' },
            h('img', { src: source, alt: '论文插图', loading: 'lazy' }),
          )
        }
        let className = 'pr-p'
        if (index === 0 && block.size >= median * 1.3) className = 'pr-h1'
        else if (block.size >= median * 1.22 && block.text.length <= 100) className = 'pr-h2'
        else if (block.size >= median * 1.08 && block.text.length <= 140) className = 'pr-h3'
        const translated = translations[block.id]
        const translatedHtml = translationHtml[block.id]
        const formula = formulaOn ? formulaHtml[block.id] : ''
        if (view === 'zh' && translated) {
          return translatedHtml
            ? h('div', { key: block.id || index, className, 'data-block': block.id, dangerouslySetInnerHTML: { __html: translatedHtml } })
            : h('div', { key: block.id || index, className, 'data-block': block.id }, translated)
        }
        return h(
          React.Fragment,
          { key: block.id || index },
          h(
            'p',
            {
              className,
              'data-block': block.id,
              ...(formula ? { dangerouslySetInnerHTML: { __html: formula } } : {}),
            },
            formula ? undefined : block.text,
          ),
          view !== 'read' && translated
            ? translatedHtml
              ? h('div', { className: 'pr-translation', dangerouslySetInnerHTML: { __html: translatedHtml } })
              : h('div', { className: 'pr-translation' }, translated)
            : null,
        )
      })
      const hasTranslation = Object.keys(translations).length > 0
      const textCount = visible.filter((block) => block.kind !== 'image').length
      const imageCount = visible.filter((block) => block.kind === 'image').length
      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'pr-bar' },
          h(
            'div',
            { className: 'pr-row' },
            h('button', { type: 'button', className: 'pr-btn', onClick: onBack, title: '返回文献库' }, '←'),
            h('div', { className: 'pr-title', title: paper.title }, paper.title),
            h('button', { type: 'button', className: 'pr-btn', onClick: onUpload, title: '打开另一篇 PDF' }, '＋'),
            h(
              'button',
              { type: 'button', className: 'pr-btn', onClick: onNotes, title: '阅读笔记' },
              noteCount ? `✎ ${noteCount}` : '✎',
            ),
            h('button', { type: 'button', className: 'pr-btn', onClick: onSession, title: '在独立对话中打开这篇论文' }, '对话'),
          ),
          h(
            'div',
            { className: 'pr-row' },
            h('button', { type: 'button', className: 'pr-btn', onClick: onPrev, disabled: pageNumber <= 1, title: '上一页' }, '‹'),
            h('span', { className: 'pr-meta' }, `${pageNumber} / ${paper.pages}`),
            h('button', { type: 'button', className: 'pr-btn', onClick: onNext, disabled: pageNumber >= paper.pages, title: '下一页' }, '›'),
            h(
              'select',
              { className: 'pr-select', value: mode, onChange: (event) => onMode(event.target.value), title: '原文顺序' },
              h('option', { value: 'auto' }, '自动'),
              h('option', { value: 'two' }, '双栏'),
              h('option', { value: 'single' }, '单栏'),
            ),
            h('button', { type: 'button', className: 'pr-btn', onClick: () => onFont(-1), disabled: fontSize <= MIN_FONT, title: '缩小正文' }, 'A−'),
            h('button', { type: 'button', className: 'pr-btn', onClick: () => onFont(1), disabled: fontSize >= MAX_FONT, title: '放大正文' }, 'A+'),
            h(
              'button',
              { type: 'button', className: 'pr-btn', onClick: onFontMode, title: fontMode === 'serif' ? '换成黑体' : '换成宋体' },
              fontMode === 'serif' ? '宋' : '黑',
            ),
            isWeb
              ? h(
                  'a',
                  {
                    className: 'pr-btn',
                    href: paper.sourceUrl,
                    target: '_blank',
                    rel: 'noreferrer',
                    title: '打开原网页',
                  },
                  '原网页',
                )
              : h('button', { type: 'button', className: 'pr-btn', onClick: () => setPreview(true), title: '查看本页原图' }, '原页'),
          ),
          h(
            'div',
            { className: 'pr-row' },
            h('span', { className: 'pr-meta' }, '译文'),
            h(
              'button',
              { type: 'button', className: 'pr-btn' + (view === 'read' ? ' active' : ''), onClick: () => onView('read') },
              '原文',
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'pr-btn' + (view === 'dual' ? ' active' : ''),
                onClick: () => onView('dual'),
                disabled: !hasTranslation,
              },
              '对照',
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'pr-btn' + (view === 'zh' ? ' active' : ''),
                onClick: () => onView('zh'),
                disabled: !hasTranslation,
              },
              '译文',
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'pr-btn' + (formulaOn ? ' active' : ''),
                onClick: onFormulas,
                disabled: formulaBusy || !page,
                title: '把原文里的公式改写成 LaTeX 并渲染',
              },
              formulaBusy ? '公式中…' : '公式',
            ),
            h(
              'button',
              { type: 'button', className: 'pr-btn', onClick: onTranslate, disabled: !!translating || !page },
              translating ? '翻译中…' : '译本页',
            ),
            h(
              'button',
              { type: 'button', className: 'pr-btn', onClick: onTranslateAll, disabled: !!translating },
              '译全文',
            ),
            h(
              'button',
              { type: 'button', className: 'pr-btn', onClick: onQa, title: '把最近一次问答导出到 sources/ai' },
              '存问答',
            ),
            translating ? h('button', { type: 'button', className: 'pr-btn', onClick: onStop }, '停止') : null,
            h(
              'span',
              { className: 'pr-meta', style: { flex: 1, minWidth: 0, textAlign: 'right' } },
              translateStatus || (translating ? `${translating.done}/${translating.total}` : ''),
            ),
          ),
        ),
        h(
          'div',
          { className: 'pr-body' + (loading ? ' loading' : '') },
          h(
            'div',
            { className: 'pr-inner' },
            page && blocks.length !== visible.length
              ? h('p', { className: 'pr-note' }, `已隐藏 ${blocks.length - visible.length} 处作者/单位信息`)
              : null,
            body.length
              ? body
              : h('div', { className: 'pr-empty' }, loading ? `正在解析第 ${pageNumber} 页…` : '这一页没有可提取的文字。'),
          ),
        ),
        h(
          'div',
          { className: 'pr-footer' },
          h('span', null, '阅读顺序由本页布局推断'),
          h('span', null, `${textCount} 段 · ${imageCount} 图 · 第 ${pageNumber} 页`),
        ),
        preview
          ? h(
              'div',
              { className: 'pr-overlay', onClick: () => setPreview(false) },
              h('img', {
                src: `/paper-reflow/paper/${paper.id}/page-image/${pageNumber}.png?scale=2`,
                alt: `第 ${pageNumber} 页原图`,
              }),
              h('span', { className: 'pr-overlay-hint' }, '点击空白处关闭'),
            )
          : null,
      )
    }

    function App(props) {
      const sessionId = props && props.sessionId
      const onSwitchSession = props && props.onSwitchSession
      const [papers, setPapers] = useState([])
      const [paper, setPaper] = useState(null)
      const [page, setPage] = useState(null)
      const [pageNumber, setPageNumber] = useState(1)
      const [mode, setMode] = useState('auto')
      const [busy, setBusy] = useState(false)
      const [loading, setLoading] = useState(false)
      const [dragging, setDragging] = useState(false)
      const [error, setError] = useState('')
      const [fontSize, setFontSize] = useState(() => {
        const stored = Number(localStorage.getItem(FONT_KEY))
        return stored >= MIN_FONT && stored <= MAX_FONT ? stored : 16
      })
      const [fontMode, setFontMode] = useState(() =>
        localStorage.getItem(FONT_MODE_KEY) === 'sans' ? 'sans' : 'serif',
      )
      const [view, setView] = useState('read')
      const [translations, setTranslations] = useState({})
      const [translationHtml, setTranslationHtml] = useState({})
      const [formulaHtml, setFormulaHtml] = useState({})
      const [formulaOn, setFormulaOn] = useState(() => localStorage.getItem('paper-reflow:formula') === '1')
      const [formulaBusy, setFormulaBusy] = useState(false)
      const [translating, setTranslating] = useState(null)
      const [translateStatus, setTranslateStatus] = useState('')
      const [selection, setSelection] = useState(null)
      const [question, setQuestion] = useState('')
      const [asking, setAsking] = useState(false)
      const [notes, setNotes] = useState([])
      const [notesOpen, setNotesOpen] = useState(false)
      const [noteDraft, setNoteDraft] = useState(null)
      const [noteStatus, setNoteStatus] = useState('')
      const [url, setUrl] = useState('')
      const [urlBusy, setUrlBusy] = useState(false)
      const [renameTarget, setRenameTarget] = useState(null)
      const [deleteTarget, setDeleteTarget] = useState('')
      const [folders, setFolders] = useState([])
      const [activeFolder, setActiveFolder] = useState('all')
      const [search, setSearch] = useState('')
      const [folderDraft, setFolderDraft] = useState(null)
      const [deleteFolderTarget, setDeleteFolderTarget] = useState('')
      const bubbleRef = useRef(null)
      const stopRef = useRef(false)
      const pageNumberRef = useRef(1)
      const formulaOnRef = useRef(localStorage.getItem('paper-reflow:formula') === '1')
      const fileRef = useRef(null)
      const rootRef = useRef(null)
      const ticket = useRef(0)
      const saveTimer = useRef(null)
      const modeRef = useRef('auto')

      function scheduleSave(target, number, view) {
        if (!target) return
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => {
          fetch(`/paper-reflow/paper/${target.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lastPage: number, view }),
          }).catch(() => {})
        }, 500)
      }

      async function loadPage(target, number, nextMode) {
        const current = ++ticket.current
        setLoading(true)
        setError('')
        setSelection(null)
        try {
          const data = await api(`/paper-reflow/paper/${target.id}/page/${number}?mode=${nextMode}`)
          if (current !== ticket.current) return
          setPage(data)
          setPageNumber(number)
          pageNumberRef.current = number
          setMode(nextMode)
          modeRef.current = nextMode
          setTranslations({})
          setTranslationHtml({})
          setFormulaHtml({})
          api(`/paper-reflow/paper/${target.id}/translations?page=${number}`)
            .then((cached) => {
              if (current === ticket.current) {
                setTranslations(cached.translations || {})
                setTranslationHtml(cached.html || {})
              }
            })
            .catch(() => {})
          if (formulaOnRef.current) {
            api(`/paper-reflow/paper/${target.id}/formulas?page=${number}`)
              .then((cached) => {
                if (current === ticket.current) setFormulaHtml(cached.html || {})
              })
              .catch(() => {})
          }
          scheduleSave(target, number, nextMode)
        } catch (err) {
          if (current === ticket.current) setError(err.message || '这一页解析失败。')
        } finally {
          if (current === ticket.current) setLoading(false)
        }
      }

      function openPaper(target) {
        setPaper(target)
        setPage(null)
        setPageNumber(1)
        setView('read')
        setTranslations({})
        setNotes([])
        setNoteStatus('')
        localStorage.setItem(STORAGE_KEY, target.id)
        refreshNotes(target)
        if (sessionId) {
          fetch('/paper-reflow/activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, paperId: target.id }),
          }).catch(() => {})
        }
        loadPage(target, target.lastPage || 1, 'auto')
      }

      function openLibrary() {
        setPaper(null)
        setPage(null)
        localStorage.removeItem(STORAGE_KEY)
      }

      function step(delta) {
        if (!paper) return
        const next = Math.min(paper.pages, Math.max(1, pageNumber + delta))
        if (next !== pageNumber) loadPage(paper, next, modeRef.current)
      }

      function changeMode(nextMode) {
        if (!paper) return
        loadPage(paper, pageNumber, nextMode)
      }

      function changeFont(delta) {
        setFontSize((current) => {
          const next = Math.min(MAX_FONT, Math.max(MIN_FONT, current + delta))
          localStorage.setItem(FONT_KEY, String(next))
          return next
        })
      }

      function toggleFontMode() {
        setFontMode((current) => {
          const next = current === 'serif' ? 'sans' : 'serif'
          localStorage.setItem(FONT_MODE_KEY, next)
          return next
        })
      }

      async function upload(file) {
        if (!file) return
        if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
          setError('请选择 PDF 文件。')
          return
        }
        setBusy(true)
        setError('')
        try {
          const response = await fetch('/paper-reflow/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/pdf', 'x-file-name': encodeURIComponent(file.name) },
            body: file,
          })
          const text = await response.text()
          const data = text ? JSON.parse(text) : null
          if (!response.ok) throw new Error((data && data.error) || '上传失败')
          setPapers((previous) => [data.paper, ...previous.filter((item) => item.id !== data.paper.id)])
          openPaper(data.paper)
        } catch (err) {
          setError(err.message || '上传失败')
        } finally {
          setBusy(false)
          if (fileRef.current) fileRef.current.value = ''
        }
      }

      function pageTextBlocks(data) {
        return ((data && data.blocks) || []).filter(
          (block) => block.kind !== 'image' && block.role !== 'meta' && block.text && block.text.trim(),
        )
      }

      async function requestTranslate(target, number, blocks) {
        const batches = []
        let batch = []
        let size = 0
        for (const block of blocks) {
          if (batch.length && (batch.length >= 8 || size + block.text.length > 3500)) {
            batches.push(batch)
            batch = []
            size = 0
          }
          batch.push({ id: block.id, text: block.text })
          size += block.text.length
        }
        if (batch.length) batches.push(batch)
        let merged = {}
        let mergedHtml = {}
        for (const part of batches) {
          if (stopRef.current) break
          const result = await api('/paper-reflow/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paperId: target.id, page: number, target: '简体中文', blocks: part }),
          })
          merged = { ...merged, ...(result.translations || {}) }
          mergedHtml = { ...mergedHtml, ...(result.html || {}) }
        }
        if (number === pageNumberRef.current) {
          setTranslations((previous) => ({ ...previous, ...merged }))
          setTranslationHtml((previous) => ({ ...previous, ...mergedHtml }))
        }
        return merged
      }

      async function translateCurrent() {
        if (!paper || !page) {
          setTranslateStatus('页面还没加载完')
          return
        }
        const blocks = pageTextBlocks(page)
        if (!blocks.length) {
          setTranslateStatus('本页没有可翻译的正文')
          return
        }
        stopRef.current = false
        setError('')
        setTranslateStatus(`正在翻译 ${blocks.length} 段…`)
        setTranslating({ done: 0, total: 1 })
        try {
          const merged = await requestTranslate(paper, pageNumberRef.current, blocks)
          const count = Object.keys(merged).length
          setTranslateStatus(count ? `已译 ${count}/${blocks.length} 段` : '模型没有返回可用译文')
          if (count) setView('dual')
        } catch (err) {
          console.error('[paper-reflow] translate failed', err)
          setTranslateStatus('翻译失败：' + (err.message || '未知错误'))
          setError(err.message || '翻译失败')
        } finally {
          setTranslating(null)
        }
      }

      async function toggleFormulas() {
        if (!paper || !page) return
        const next = !formulaOn
        setFormulaOn(next)
        formulaOnRef.current = next
        localStorage.setItem('paper-reflow:formula', next ? '1' : '0')
        if (!next) {
          setFormulaHtml({})
          return
        }
        setFormulaBusy(true)
        setError('')
        try {
          const blocks = pageTextBlocks(page)
          const data = await api(`/paper-reflow/paper/${paper.id}/formulas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: pageNumberRef.current, blocks }),
          })
          setFormulaHtml(data.html || {})
        } catch (err) {
          setError(err.message || '公式处理失败')
        } finally {
          setFormulaBusy(false)
        }
      }

      async function translateAll() {
        if (!paper) return
        stopRef.current = false
        setError('')
        setTranslateStatus('正在翻译全文…')
        setTranslating({ done: 0, total: paper.pages })
        try {
          for (let number = 1; number <= paper.pages; number++) {
            if (stopRef.current) break
            setTranslateStatus(`正在翻译第 ${number}/${paper.pages} 页…`)
            const data =
              number === pageNumberRef.current
                ? page
                : await api(`/paper-reflow/paper/${paper.id}/page/${number}?mode=${modeRef.current}`)
            await requestTranslate(paper, number, pageTextBlocks(data))
            setTranslating({ done: number, total: paper.pages })
          }
          setTranslateStatus(stopRef.current ? '已停止翻译' : `全文翻译完成（${paper.pages} 页）`)
        } catch (err) {
          console.error('[paper-reflow] translate all failed', err)
          setTranslateStatus('翻译失败：' + (err.message || '未知错误'))
          setError(err.message || '翻译失败')
        } finally {
          setTranslating(null)
        }
      }

      function stopTranslate() {
        stopRef.current = true
      }

      function handleMouseUp() {
        const root = rootRef.current
        if (!root) return
        const selected = window.getSelection()
        if (!selected || selected.isCollapsed) return
        const text = selected.toString().trim()
        if (!text) return
        if (!selected.anchorNode || !root.contains(selected.anchorNode)) return
        const rect = selected.getRangeAt(0).getBoundingClientRect()
        const rootRect = root.getBoundingClientRect()
        const width = Math.min(360, Math.max(240, rootRect.width - 24))
        setSelection({
          text: text.slice(0, 600),
          x: Math.min(Math.max(8, rect.left - rootRect.left), Math.max(8, rootRect.width - width - 8)),
          y: Math.min(Math.max(8, rect.bottom - rootRect.top + 6), Math.max(8, rootRect.height - 250)),
        })
        setQuestion('')
      }

      async function askSelection() {
        if (!selection || !paper || asking) return
        const text = question.trim()
        if (!text) return
        if (!sessionId) {
          setError('无法确定当前会话，请刷新页面后重试。')
          return
        }
        setAsking(true)
        setError('')
        try {
          await api('/paper-reflow/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              paperId: paper.id,
              page: pageNumberRef.current,
              quote: selection.text,
              question: text,
            }),
          })
          setSelection(null)
          setQuestion('')
          if (window.getSelection) window.getSelection().removeAllRanges()
        } catch (err) {
          setError(err.message || '发送失败')
        } finally {
          setAsking(false)
        }
      }

      async function refreshNotes(target) {
        if (!target) return
        try {
          const data = await api(`/paper-reflow/paper/${target.id}/notes`)
          setNotes(data.notes || [])
        } catch {
          setNotes([])
        }
      }

      async function saveNote() {
        if (!paper || !noteDraft || !noteDraft.text.trim()) return
        try {
          const data = await api(`/paper-reflow/paper/${paper.id}/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: noteDraft.page, quote: noteDraft.quote, text: noteDraft.text }),
          })
          setNoteDraft(null)
          setNoteStatus(data.exportPath ? `已保存到 ${data.exportPath}` : '已保存到本机笔记')
          setSelection(null)
          if (window.getSelection) window.getSelection().removeAllRanges()
          refreshNotes(paper)
        } catch (err) {
          setError(err.message || '保存笔记失败')
        }
      }

      async function deleteNote(noteId) {
        if (!paper) return
        try {
          await api(`/paper-reflow/paper/${paper.id}/notes/${noteId}`, { method: 'DELETE' })
          refreshNotes(paper)
        } catch (err) {
          setError(err.message || '删除失败')
        }
      }

      async function exportNotes() {
        if (!paper) return
        try {
          const data = await api(`/paper-reflow/paper/${paper.id}/notes/export`, { method: 'POST' })
          setNoteStatus(`已导出到 ${data.path}`)
        } catch (err) {
          setNoteStatus(err.message || '导出失败')
        }
      }

      async function exportQa() {
        if (!paper) return
        setTranslateStatus('')
        try {
          const data = await api(`/paper-reflow/paper/${paper.id}/qa/export`, { method: 'POST' })
          setTranslateStatus(`问答已存到 ${data.path}`)
        } catch (err) {
          setTranslateStatus(err.message || '问答导出失败')
        }
      }

      async function openPaperSession() {
        if (!paper) return
        setError('')
        try {
          const data = await api(`/paper-reflow/paper/${paper.id}/session`, { method: 'POST' })
          if (onSwitchSession && data.sessionId) onSwitchSession(data.sessionId)
        } catch (err) {
          setError(err.message || '打开独立对话失败')
        }
      }

      async function addUrl() {
        const value = url.trim()
        if (!value) return
        setUrlBusy(true)
        setError('')
        try {
          const data = await api('/paper-reflow/add-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: value }),
          })
          setPapers((previous) => [data.paper, ...previous.filter((item) => item.id !== data.paper.id)])
          setUrl('')
          openPaper(data.paper)
        } catch (err) {
          setError(err.message || '打开链接失败')
        } finally {
          setUrlBusy(false)
        }
      }

      async function saveRename() {
        if (!renameTarget || !renameTarget.title.trim()) return
        const title = renameTarget.title.trim()
        const folderId = renameTarget.folderId || null
        try {
          await api(`/paper-reflow/paper/${renameTarget.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, folderId }),
          })
          setPapers((previous) =>
            previous.map((item) => (item.id === renameTarget.id ? { ...item, title, folderId } : item)),
          )
          if (paper && paper.id === renameTarget.id) setPaper({ ...paper, title, folderId })
          setRenameTarget(null)
        } catch (err) {
          setError(err.message || '重命名失败')
        }
      }

      async function createFolder() {
        const name = folderDraft && String(folderDraft.name || '').trim()
        if (!name) return
        try {
          const data = await api('/paper-reflow/library/folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          })
          setFolders((previous) => [...previous, data.folder])
          setFolderDraft(null)
          setActiveFolder(data.folder.id)
        } catch (err) {
          setError(err.message || '创建文件夹失败')
        }
      }

      async function deleteFolder() {
        if (activeFolder === 'all' || activeFolder === 'none') return
        if (deleteFolderTarget !== activeFolder) {
          setDeleteFolderTarget(activeFolder)
          setTimeout(() => setDeleteFolderTarget(''), 4000)
          return
        }
        try {
          await api(`/paper-reflow/library/folders/${activeFolder}`, { method: 'DELETE' })
          setFolders((previous) => previous.filter((item) => item.id !== activeFolder))
          setPapers((previous) =>
            previous.map((item) => (item.folderId === activeFolder ? { ...item, folderId: null } : item)),
          )
          setDeleteFolderTarget('')
          setActiveFolder('all')
        } catch (err) {
          setError(err.message || '删除文件夹失败')
        }
      }

      async function deletePaper(target) {
        if (deleteTarget !== target.id) {
          setDeleteTarget(target.id)
          setTimeout(() => setDeleteTarget(''), 4000)
          return
        }
        try {
          await api(`/paper-reflow/paper/${target.id}`, { method: 'DELETE' })
          setDeleteTarget('')
          setPapers((previous) => previous.filter((item) => item.id !== target.id))
          if (paper && paper.id === target.id) openLibrary()
        } catch (err) {
          setError(err.message || '删除失败')
        }
      }

      useEffect(() => {
        if (!selection) return undefined
        const onPointerDown = (event) => {
          if (bubbleRef.current && !bubbleRef.current.contains(event.target)) setSelection(null)
        }
        const onScroll = () => setSelection(null)
        const onKey = (event) => {
          if (event.key === 'Escape') setSelection(null)
        }
        document.addEventListener('mousedown', onPointerDown, true)
        document.addEventListener('keydown', onKey, true)
        window.addEventListener('scroll', onScroll, true)
        return () => {
          document.removeEventListener('mousedown', onPointerDown, true)
          document.removeEventListener('keydown', onKey, true)
          window.removeEventListener('scroll', onScroll, true)
        }
      }, [selection])

      useEffect(() => {
        const onJump = (event) => {
          const detail = event.detail || {}
          if (!paper) return
          if (detail.paper && detail.paper !== paper.id) return
          const target = Number(detail.page)
          if (!Number.isInteger(target) || target < 1 || target > paper.pages) return
          loadPage(paper, target, modeRef.current)
        }
        window.addEventListener('paper-reflow:jump', onJump)
        return () => window.removeEventListener('paper-reflow:jump', onJump)
      })

      useEffect(() => {
        let cancelled = false
        ;(async () => {
          try {
            const data = await api('/paper-reflow/library')
            if (cancelled) return
            setPapers(data.papers || [])
            setFolders(data.folders || [])
            const last = localStorage.getItem(STORAGE_KEY)
            const target = (data.papers || []).find((item) => item.id === last)
            if (target) openPaper(target)
          } catch (err) {
            if (!cancelled) setError(err.message || '无法读取文献库。')
          }
        })()
        return () => {
          cancelled = true
          if (saveTimer.current) clearTimeout(saveTimer.current)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      useEffect(() => {
        const root = rootRef.current
        if (!root) return undefined
        const onKeyDown = (event) => {
          if (!root.contains(document.activeElement)) return
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            step(-1)
          } else if (event.key === 'ArrowRight') {
            event.preventDefault()
            step(1)
          }
        }
        root.addEventListener('keydown', onKeyDown)
        return () => root.removeEventListener('keydown', onKeyDown)
      })

      const pick = () => fileRef.current && fileRef.current.click()

      const visiblePapers = papers.filter((item) => {
        const folderOk =
          activeFolder === 'all' ? true : activeFolder === 'none' ? !item.folderId : item.folderId === activeFolder
        const needle = search.trim().toLowerCase()
        const searchOk =
          !needle ||
          String(item.title || '').toLowerCase().includes(needle) ||
          String(item.sourceUrl || '').toLowerCase().includes(needle)
        return folderOk && searchOk
      })

      return h(
        'div',
        {
          className: 'pr-root' + (fontMode === 'sans' ? ' pr-sans' : ''),
          ref: rootRef,
          tabIndex: 0,
          style: { '--pr-font': `${fontSize}px` },
          onMouseUp: handleMouseUp,
          onDragOver: (event) => {
            event.preventDefault()
            setDragging(true)
          },
          onDragLeave: () => setDragging(false),
          onDrop: (event) => {
            event.preventDefault()
            setDragging(false)
            const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]
            if (file) upload(file)
          },
        },
        h('style', null, CSS),
        h('link', { rel: 'stylesheet', href: '/paper-reflow/vendor/katex.min.css' }),
        error ? h('div', { className: 'pr-banner' }, error) : null,
        paper
          ? h(Reader, {
              paper,
              page,
              pageNumber,
              mode,
              loading,
              fontSize,
              fontMode,
              view,
              translations,
              translationHtml,
              translating,
              translateStatus,
              formulaHtml,
              formulaOn,
              formulaBusy,
              onFormulas: toggleFormulas,
              onQa: exportQa,
              onView: setView,
              onTranslate: translateCurrent,
              onTranslateAll: translateAll,
              onStop: stopTranslate,
              onFont: changeFont,
              onFontMode: toggleFontMode,
              onBack: openLibrary,
              onPrev: () => step(-1),
              onNext: () => step(1),
              onMode: changeMode,
              onUpload: pick,
              noteCount: notes.length,
              onNotes: () => {
                setNoteStatus('')
                setNotesOpen(true)
              },
              onSession: openPaperSession,
            })
          : h(EmptyState, {
              papers: visiblePapers,
              busy,
              dragging,
              onPick: pick,
              onOpen: openPaper,
              url,
              urlBusy,
              onUrl: setUrl,
              onAddUrl: addUrl,
              onRename: (item) => setRenameTarget({ id: item.id, title: item.title, folderId: item.folderId || '' }),
              onDelete: deletePaper,
              deleteTarget,
              folders,
              activeFolder,
              onFolder: setActiveFolder,
              search,
              onSearch: setSearch,
              onNewFolder: () => setFolderDraft({ name: '' }),
              onDeleteFolder: deleteFolder,
              deleteFolderTarget,
            }),
        selection
          ? h(
              'div',
              { className: 'pr-sel', ref: bubbleRef, style: { left: selection.x, top: selection.y } },
              h('div', { className: 'pr-sel-quote' }, selection.text),
              h('textarea', {
                autoFocus: true,
                rows: 2,
                value: question,
                placeholder: '就这段提问…（Enter 发送，Shift+Enter 换行）',
                onChange: (event) => setQuestion(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    askSelection()
                  } else if (event.key === 'Escape') {
                    setSelection(null)
                  }
                },
              }),
              h(
                'div',
                { className: 'pr-sel-row', style: { justifyContent: 'flex-end' } },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'pr-btn',
                    onClick: () => {
                      setNoteDraft({ quote: selection.text, page: pageNumberRef.current, text: '' })
                      setSelection(null)
                      if (window.getSelection) window.getSelection().removeAllRanges()
                    },
                  },
                  '记笔记',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'pr-btn',
                    onClick: () => {
                      if (navigator.clipboard) navigator.clipboard.writeText(selection.text).catch(() => {})
                      setSelection(null)
                    },
                  },
                  '复制',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'pr-btn',
                    onClick: askSelection,
                    disabled: asking || !question.trim(),
                  },
                  asking ? '发送中…' : '问这段',
                ),
              ),
            )
          : null,
        noteDraft
          ? h(
              'div',
              { className: 'pr-overlay center', onClick: () => setNoteDraft(null) },
              h(
                'div',
                { className: 'pr-note-editor', onClick: (event) => event.stopPropagation() },
                h(
                  'div',
                  { className: 'pr-sel-row' },
                  h('strong', null, `第 ${noteDraft.page} 页`),
                  h('span', { className: 'pr-meta' }, '记一条'),
                ),
                noteDraft.quote ? h('div', { className: 'pr-sel-quote' }, noteDraft.quote) : null,
                h('textarea', {
                  autoFocus: true,
                  value: noteDraft.text,
                  placeholder: '我为什么在意这一段？它改变了什么？',
                  onChange: (event) => setNoteDraft({ ...noteDraft, text: event.target.value }),
                }),
                h(
                  'div',
                  { className: 'pr-sel-row', style: { justifyContent: 'flex-end' } },
                  h('button', { type: 'button', className: 'pr-btn', onClick: () => setNoteDraft(null) }, '取消'),
                  h(
                    'button',
                    { type: 'button', className: 'pr-btn', onClick: saveNote, disabled: !noteDraft.text.trim() },
                    '保存',
                  ),
                ),
              ),
            )
          : null,
        notesOpen
          ? h(
              'div',
              { className: 'pr-overlay center', onClick: () => setNotesOpen(false) },
              h(
                'div',
                { className: 'pr-notes-panel', onClick: (event) => event.stopPropagation() },
                h(
                  'div',
                  { className: 'pr-sel-row' },
                  h('strong', null, '阅读笔记'),
                  h('span', { className: 'pr-meta' }, `${notes.length} 条`),
                  h('span', { style: { flex: 1 } }),
                  h(
                    'button',
                    { type: 'button', className: 'pr-btn', onClick: exportNotes, disabled: !notes.length },
                    '导出到知识库',
                  ),
                ),
                notes.length
                  ? h(
                      'ul',
                      { className: 'pr-list' },
                      notes.map((note) =>
                        h(
                          'li',
                          { key: note.id, className: 'pr-item' },
                          h(
                            'div',
                            {
                              className: 'pr-note-item',
                              onClick: () => {
                                if (!paper) return
                                loadPage(paper, note.page, modeRef.current)
                                setNotesOpen(false)
                              },
                            },
                            h('div', { className: 'pr-meta' }, `第 ${note.page} 页`),
                            note.quote ? h('div', { className: 'pr-note-quote' }, note.quote.slice(0, 140)) : null,
                            h('div', null, note.text),
                          ),
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'pr-btn',
                              onClick: (event) => {
                                event.stopPropagation()
                                deleteNote(note.id)
                              },
                            },
                            '删',
                          ),
                        ),
                      ),
                    )
                  : h('div', { className: 'pr-empty' }, '还没有笔记。选中一段文字后点「记笔记」。'),
                noteStatus ? h('div', { className: 'pr-meta' }, noteStatus) : null,
              ),
            )
          : null,
        renameTarget
          ? h(
              'div',
              { className: 'pr-overlay center', onClick: () => setRenameTarget(null) },
              h(
                'div',
                { className: 'pr-note-editor', onClick: (event) => event.stopPropagation() },
                h('strong', null, '重命名文献'),
                h('input', {
                  autoFocus: true,
                  value: renameTarget.title,
                  onChange: (event) => setRenameTarget({ ...renameTarget, title: event.target.value }),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') saveRename()
                    else if (event.key === 'Escape') setRenameTarget(null)
                  },
                }),
                h(
                  'select',
                  {
                    className: 'pr-select',
                    value: renameTarget.folderId || '',
                    onChange: (event) => setRenameTarget({ ...renameTarget, folderId: event.target.value }),
                  },
                  h('option', { value: '' }, '未分类'),
                  folders.map((folder) => h('option', { key: folder.id, value: folder.id }, folder.name)),
                ),
                h(
                  'div',
                  { className: 'pr-sel-row', style: { justifyContent: 'flex-end' } },
                  h('button', { type: 'button', className: 'pr-btn', onClick: () => setRenameTarget(null) }, '取消'),
                  h(
                    'button',
                    { type: 'button', className: 'pr-btn', onClick: saveRename, disabled: !renameTarget.title.trim() },
                    '保存',
                  ),
                ),
              ),
            )
          : null,
        folderDraft
          ? h(
              'div',
              { className: 'pr-overlay center', onClick: () => setFolderDraft(null) },
              h(
                'div',
                { className: 'pr-note-editor', onClick: (event) => event.stopPropagation() },
                h('strong', null, '新建文件夹'),
                h('input', {
                  autoFocus: true,
                  value: folderDraft.name,
                  placeholder: '文件夹名称',
                  onChange: (event) => setFolderDraft({ ...folderDraft, name: event.target.value }),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') createFolder()
                    else if (event.key === 'Escape') setFolderDraft(null)
                  },
                }),
                h(
                  'div',
                  { className: 'pr-sel-row', style: { justifyContent: 'flex-end' } },
                  h('button', { type: 'button', className: 'pr-btn', onClick: () => setFolderDraft(null) }, '取消'),
                  h(
                    'button',
                    { type: 'button', className: 'pr-btn', onClick: createFolder, disabled: !folderDraft.name.trim() },
                    '创建',
                  ),
                ),
              ),
            )
          : null,
        h('input', {
          ref: fileRef,
          type: 'file',
          accept: 'application/pdf,.pdf',
          style: { display: 'none' },
          onChange: (event) => {
            const file = event.target.files && event.target.files[0]
            if (file) upload(file)
          },
        }),
      )
    }

    return {
      inject: ['slots', 'locale', 'layout', 'uiWorkspace', 'sidebarRight', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(() =>
          ctx.sidebarRightTabs.register({
            id: TAB_ID,
            kind: TAB_ID,
            title: () => '论文阅读',
          }),
        )

        function switchToSession(sessionId) {
          let attempts = 0
          const attempt = () => {
            attempts += 1
            try {
              ctx.sidebarRight.openTabIn(sessionId, TAB_ID, { revealIfOpened: true })
            } catch (error) {
              console.error('[paper-reflow] openTabIn failed', error)
              if (attempts < 12) {
                setTimeout(attempt, 200)
                return
              }
            }
            try {
              ctx.uiWorkspace.openSession(sessionId)
            } catch (error) {
              console.error('[paper-reflow] openSession failed', error)
            }
          }
          attempt()
        }

        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register(
            { name: 'sidebar.right.pane.tab', key: TAB_ID },
            (props) => h(App, { ...props, onSwitchSession: switchToSession }),
          ),
        )

        function OpenAction(props) {
          const wide = !props || props.wide !== false
          return h(
            'button',
            {
              type: 'button',
              title: '打开论文阅读阅读器',
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 28,
                padding: '0 8px',
                border: '1px solid var(--dsw-alias-border-l1)',
                borderRadius: 6,
                background: 'transparent',
                color: 'var(--dsw-alias-label-primary)',
                cursor: 'pointer',
                font: 'inherit',
                fontSize: 12,
              },
              onClick: () => {
                try {
                  ctx.sidebarRight.openTab(TAB_ID, { revealIfOpened: true })
                } catch (err) {
                  console.error('[paper-reflow] openTab failed', err)
                  try {
                    ctx.layout.openRightbar(true, false)
                  } catch (err2) {
                    console.error('[paper-reflow] openRightbar failed', err2)
                  }
                }
              },
            },
            h('span', { 'aria-hidden': true }, '▤'),
            wide ? h('span', null, '论文阅读') : null,
          )
        }

        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register({ name: 'sidebar.footer.action', id: 'paper-reflow-open', order: 10 }, OpenAction),
        )

        ctx.effect(() => {
          const onClick = (event) => {
            const target = event.target
            const anchor = target && target.closest ? target.closest('a[href*="/paper-reflow/jump"]') : null
            if (!anchor) return
            let url
            try {
              url = new URL(anchor.href)
            } catch {
              return
            }
            const page = Number(url.searchParams.get('page'))
            if (!Number.isInteger(page) || page < 1) return
            event.preventDefault()
            event.stopImmediatePropagation()
            window.dispatchEvent(
              new CustomEvent('paper-reflow:jump', {
                detail: { paper: url.searchParams.get('paper'), page },
              }),
            )
          }
          document.addEventListener('click', onClick, true)
          return () => document.removeEventListener('click', onClick, true)
        })
      },
    }
  },
})
