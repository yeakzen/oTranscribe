# 编辑器内 Markdown 文档块支持方案

## 1. 需求澄清

本方案讨论的不是 Markdown 文件导入导出，也不是把整个 oTranscribe 文档格式改成 Markdown。

目标是：

- 在正文底部工具栏增加一个 Markdown 按钮。
- 用户点击按钮后，在当前光标位置插入一个 Markdown 文档块。
- 用户可以在这个块里输入 Markdown 源文本。
- Markdown 块可以将输入内容渲染为格式化预览。
- 块作为原文档的一部分参与自动保存、历史备份、多文档切换和 `.otr` 保存。

结论：这个功能可行，但不建议把 Markdown 块做成普通 `contenteditable` 子节点里的“自由嵌套编辑区”。更稳妥的方案是把 Markdown 块设计成一个受控组件：外层是不可整体拆散的 HTML 块，内部用 `<textarea>` 编辑 Markdown 源文本，用独立预览区域渲染 Markdown。

## 2. 现有架构影响

当前正文编辑区是：

```html
<div id="textbox" class="mousetrap" contenteditable="true">
```

文档内容、自动保存和历史备份保存的是 `#textbox.innerHTML`。

这意味着 Markdown 块如果插入正文，最终也必须能被序列化成安全 HTML，并在恢复时重新激活交互行为。

相关现有能力：

- `src/html/textbox.htm`：工具栏按钮和 `#textbox` 编辑区。
- `src/js/app/texteditor.js`：设置正文内容，并调用 `activateTimestamps()`。
- `src/js/app/documents.js`：保存当前文档 HTML。
- `src/js/app/backup.js`：保存和恢复 HTML 历史。
- `src/js/app/clean-html.js`：清洗 HTML，只允许少量标签和属性。
- `src/js/app/timestamps.js`：插入和激活可点击时间戳。

## 3. 是否与原有功能冲突

### 3.1 与主编辑器的冲突

主编辑器是一个大的 `contenteditable`。如果 Markdown 块内部也使用 `contenteditable`，会形成嵌套编辑区，容易出现：

- 光标跳出或无法进入块。
- 删除键把整个块结构拆坏。
- 粘贴内容被浏览器自动改写。
- `Ctrl+B`、`Ctrl+I` 被外层编辑器拦截。
- 选区跨越 Markdown 块和普通正文时行为不可控。

建议：Markdown 源文本编辑不要使用内部 `contenteditable`，而使用 `<textarea>`。

### 3.2 与自动保存和历史备份的冲突

现有保存机制会保存 `#textbox.innerHTML`。如果 Markdown 块里有 `<textarea>`，直接保存 innerHTML 时会出现一个关键问题：

- `<textarea>` 当前输入值不一定体现在 `innerHTML` 里。

也就是说，用户在 textarea 中输入的 Markdown 可能不会被自动保存。

解决方式：

- Markdown 块每次输入时，把源文本同步到块外层的 `data-markdown` 属性，或同步到一个隐藏元素。
- 保存前统一调用 `syncMarkdownBlocks()`，确保 DOM 中的可序列化数据是最新的。
- 恢复文档后调用 `hydrateMarkdownBlocks()`，用保存的源文本重建 textarea 和预览区。

### 3.3 与 HTML 清洗的冲突

`cleanHTML()` 当前不允许 `div`、`textarea`、`button`、`pre`、`code`、`ul`、`ol`、`li` 等标签，也不允许自定义 `data-markdown` 属性。

Markdown 块要被保存和恢复，需要扩展清洗白名单。

但不能简单放开所有标签。Markdown 渲染本身也可能带来 XSS 风险。

建议：

- Markdown 块外层允许一个固定结构。
- Markdown 渲染输出必须经过 sanitize。
- 只允许 Markdown 预览需要的安全标签。
- 不允许脚本、样式、事件属性。

### 3.4 与时间戳的冲突

Markdown 块可以有两种策略：

第一种：Markdown 块内部不支持 oTranscribe 时间戳。

- 最简单。
- 插入时间戳按钮仍只作用于普通正文。
- Markdown 块只负责 Markdown 文档片段。

第二种：Markdown 块内部支持时间戳语法。

可约定：

```markdown
[00:12](otranscribe://timestamp/12.34)
```

渲染时转换为：

```html
<span class="timestamp" data-timestamp="12.34">00:12</span>
```

这个方案更完整，但需要额外解析和事件绑定。

建议第一版先不支持 Markdown 块内插入交互时间戳，只保证块外原有时间戳不受影响。第二版再扩展 Markdown 块内时间戳。

### 3.5 与工具栏加粗/斜体的冲突

当光标在 Markdown textarea 中时，原工具栏的加粗/斜体按钮不能继续调用 `document.execCommand()`，否则会作用到外层编辑器或无效。

可选策略：

- 第一版：Markdown 块内只支持手动输入 Markdown 语法，不响应外层加粗/斜体按钮。
- 第二版：当焦点在 Markdown 块 textarea 中时，加粗/斜体按钮改为包裹 `**` / `_`。

建议第一版不改现有加粗/斜体按钮逻辑，只新增 Markdown 块自己的编辑体验。

## 4. 推荐实现方案

### 4.1 块模型

Markdown 块应作为一个独立 HTML 块插入 `#textbox`：

```html
<div
  class="markdown-block"
  contenteditable="false"
  data-markdown="..."
>
  <div class="markdown-block-toolbar">
    <button type="button" data-action="edit">Edit</button>
    <button type="button" data-action="preview">Preview</button>
    <button type="button" data-action="remove">Remove</button>
  </div>
  <textarea class="markdown-block-source"></textarea>
  <div class="markdown-block-preview"></div>
</div>
```

关键点：

- 外层 `contenteditable="false"`，避免主编辑器把块内部结构拆散。
- Markdown 源文本存在 `data-markdown` 中，保证保存时可序列化。
- textarea 只作为编辑控件，恢复时可由 `data-markdown` 重建。
- 预览区由 Markdown 源文本渲染，不作为权威数据源。

注意：`data-markdown` 如果直接存原文，需要处理换行、引号和特殊字符。更稳妥的方式是保存 URL-safe 编码或 base64 编码后的源文本。

推荐属性：

```html
<div
  class="markdown-block"
  contenteditable="false"
  data-markdown-encoded="..."
>
```

### 4.2 插入行为

新增工具栏按钮：

- icon：可用 `fa-file-text-o` 或 `fa-code`
- label：`Markdown`
- 点击行为：在当前光标位置插入 Markdown 块

默认内容建议：

```markdown
### Markdown block

Write **Markdown** here.
```

插入后：

- 块进入编辑模式。
- 焦点移动到 textarea。
- 光标位于默认文本末尾或全选默认文本。
- 在块后插入一个普通空段落，方便用户继续输入正文。

### 4.3 编辑和预览模式

Markdown 块内部建议有两种状态：

- 编辑：显示 textarea，隐藏预览。
- 预览：隐藏 textarea，显示渲染结果。

可选增强：

- 分栏模式：左侧编辑，右侧预览。
- 自动预览：输入时实时更新预览。

第一版建议：

- 默认插入后显示编辑模式。
- 块工具栏提供 `Preview` / `Edit` 切换。
- 输入时实时更新预览内容，但预览区域可隐藏。

### 4.4 Markdown 渲染

建议新增模块：

```text
src/js/app/markdown-blocks.js
```

模块职责：

- 插入 Markdown 块。
- 同步 textarea 内容到 `data-markdown-encoded`。
- 渲染 Markdown 预览。
- 文档加载后重新激活所有 Markdown 块。
- 保存前同步所有 Markdown 块。
- 处理块内按钮事件。

需要引入 Markdown 解析库，例如：

- `marked`
- `markdown-it`

考虑当前项目已经使用 `turndown` 做 HTML 到 Markdown，新增 Markdown 到 HTML 解析库即可。

渲染流程：

```text
Markdown 源文本
  -> Markdown parser 转 HTML
  -> sanitize-html 清洗
  -> 写入 .markdown-block-preview
```

### 4.5 保存和恢复

保存前：

```text
遍历所有 .markdown-block
  读取 textarea.value
  编码后写入 data-markdown-encoded
  可选：把预览 HTML 更新到 preview
保存 #textbox.innerHTML
```

恢复后：

```text
setEditorContents(html)
  -> cleanHTML(html)
  -> 写入 #textbox.innerHTML
  -> activateTimestamps()
  -> hydrateMarkdownBlocks()
```

`hydrateMarkdownBlocks()`：

- 找到所有 `.markdown-block`。
- 解码 `data-markdown-encoded`。
- 重建或填充 textarea。
- 重新渲染 preview。
- 绑定 Edit / Preview / Remove 事件。

### 4.6 清洗规则

需要允许 Markdown 块保存所需结构。

建议最小允许：

- `div`
- `textarea`
- `button`

但直接允许这些标签会扩大整个文档的可保存 HTML 范围。

更稳妥的做法：

- 不把 textarea 和 button 作为持久化结构保存。
- 保存前将 Markdown 块压缩成一个占位块。
- 恢复后再 hydrate 成完整交互结构。

持久化结构建议：

```html
<div
  class="markdown-block"
  contenteditable="false"
  data-markdown-encoded="..."
></div>
```

这样 `cleanHTML()` 只需要允许：

- `div`
- `class`
- `contenteditable`
- `data-markdown-encoded`

恢复后再由 JavaScript 添加 toolbar、textarea、preview。

预览 HTML 不作为保存内容，因此不需要让清洗规则允许完整 Markdown 预览结构进入文档主 HTML。

这是第一版最推荐的方案。

## 5. 交互细节

### 5.1 光标和删除

由于 Markdown 块外层 `contenteditable="false"`，它在主编辑器中会像一个不可编辑对象。

需要处理：

- 插入块后在块后追加空段落。
- 用户点击块时选中或进入块内编辑。
- 删除块用块内 Remove 按钮完成。
- 不依赖 Backspace/Delete 去精确删除块，避免浏览器差异。

### 5.2 复制粘贴

第一版建议：

- 复制整个 Markdown 块时保留持久化占位结构。
- 从外部粘贴 Markdown 到普通正文时不自动创建 Markdown 块。
- 只有点击工具栏按钮才创建 Markdown 块。

### 5.3 与普通正文混排

Markdown 块前后应保留普通段落。

示例：

```html
<p>普通转写内容。</p>
<div class="markdown-block" contenteditable="false" data-markdown-encoded="..."></div>
<p>继续普通转写内容。</p>
```

这样不影响用户在块前后继续转写。

## 6. 数据格式

### 6.1 持久化 HTML

建议保存为：

```html
<div class="markdown-block" contenteditable="false" data-markdown-encoded="base64-or-uri-encoded"></div>
```

不建议保存 textarea 和 preview 的 HTML，因为：

- textarea 当前值可能不同步。
- preview 是派生内容，保存会造成冗余。
- preview HTML 会扩大清洗范围。
- 恢复后重复绑定事件更复杂。

### 6.2 编码方式

可选：

- `encodeURIComponent(markdown)`
- base64 编码 UTF-8

推荐 `encodeURIComponent`，实现简单，可读性也比 base64 稍好。

需要注意解码失败时：

- 不应丢弃整个块。
- 可以显示错误状态，并保留原始 encoded 字符串。

## 7. Markdown 支持范围

第一版建议支持：

- 段落
- 标题
- 加粗
- 斜体
- 链接
- 有序列表
- 无序列表
- 行内代码
- 代码块
- 引用

第一版不建议支持：

- 图片
- 表格
- 原始 HTML
- 脚注
- 任务列表

原因：

- 图片需要资源管理。
- 表格在转写场景中不是核心需求。
- 原始 HTML 会增加安全风险。

## 8. 安全策略

Markdown 渲染输出必须清洗。

建议允许预览标签：

- `p`
- `br`
- `strong`
- `em`
- `b`
- `i`
- `a`
- `ul`
- `ol`
- `li`
- `code`
- `pre`
- `blockquote`
- `h1`
- `h2`
- `h3`
- `h4`
- `h5`
- `h6`

建议允许属性：

- `a`: `href`, `title`, `target`, `rel`
- `code`: `class`，如果未来要做语法高亮

链接协议白名单：

- `http`
- `https`
- `mailto`

禁止：

- `<script>`
- `<style>`
- 事件属性，例如 `onclick`
- `javascript:` 链接
- 未审核的原始 HTML 块

## 9. 实施步骤

### 阶段一：可插入、可保存、可恢复

1. 新增 `markdown-blocks.js`。
2. 新增工具栏 Markdown 按钮。
3. 实现当前光标位置插入 Markdown 占位块。
4. 实现 hydrate，将占位块变成可交互块。
5. 实现 textarea 输入同步到 `data-markdown-encoded`。
6. 实现 Preview / Edit / Remove。
7. 在 `setEditorContents()` 后激活 Markdown 块。
8. 在自动保存和手动备份前同步 Markdown 块。
9. 扩展 `cleanHTML()` 允许持久化占位结构。

### 阶段二：体验增强

1. 支持分栏编辑和实时预览。
2. 当焦点在 Markdown textarea 内时，工具栏加粗/斜体包裹 Markdown 标记。
3. 支持 Markdown 块内插入时间戳语法。
4. 支持块复制、移动和键盘删除。

### 阶段三：与导出联动

如果未来需要导出 Markdown：

- 普通正文仍由 HTML 转 Markdown。
- Markdown 块直接使用源 Markdown。
- 时间戳按约定语法输出。

这不是当前需求的必要部分，可后置。

## 10. 测试建议

第一阶段至少测试：

- 点击工具栏按钮能在光标处插入 Markdown 块。
- 插入后焦点进入块内 textarea。
- Markdown 输入能渲染预览。
- Preview / Edit 切换正常。
- Remove 能删除块。
- 块前后可以继续输入普通正文。
- 自动保存后刷新页面，Markdown 源文本和预览都能恢复。
- 多文档切换后，Markdown 块能恢复。
- 历史备份恢复后，Markdown 块能恢复。
- `.otr` 导出再导入后，Markdown 块能恢复。
- 输入恶意 Markdown 或 HTML 不会执行脚本。
- 删除块周围文字不会破坏整个编辑器。

## 11. 最终建议

这个需求可行，推荐实现。

第一版最佳方案是：

- 工具栏新增 Markdown 按钮。
- 在正文中插入一个 `contenteditable="false"` 的 Markdown 块。
- 块内部用 textarea 编辑源文本。
- 渲染预览时用 Markdown parser 加 sanitize。
- 保存时只持久化一个带 `data-markdown-encoded` 的占位块。
- 恢复文档后再 hydrate 成完整交互 UI。

这样既能把 Markdown 块嵌入原文档，又不会大幅破坏现有富文本编辑、时间戳、自动保存、历史备份和 `.otr` 格式。
