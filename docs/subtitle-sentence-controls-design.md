# 字幕驱动的语句级播放控制设计文档

## 1. 背景与目标

当前 oTranscribe 已支持上传本地音频/视频文件，并通过顶部播放器控制栏完成播放、暂停、快退、快进和变速等操作。本功能希望在现有媒体播放能力之上，增加“上传字幕文件，并按字幕语句进行播放控制”的能力。

目标功能包括：

- 上传当前音频/视频对应的字幕文件。
- 基于字幕时间轴实现上一句、下一句、重复当前句播放。
- 为上述控制提供按钮和可配置快捷键。
- 播放时允许用户开关当前语句字幕显示。
- 允许用户打开“语句播完暂停”开关，普通播放到当前字幕语句结尾时自动暂停。

本设计仅描述实现方案，不包含代码实现。

## 2. 字幕格式选择

建议第一版支持 SRT 和 VTT，两者解析后统一转换为内部 cue 数据结构。

主推荐格式为 SRT：

- 用户提供的样例文件名为 `Episode 1 A.sentences.srt`。
- SRT 在按句切分字幕中更常见。
- 格式简单，正好满足本功能需要的开始时间、结束时间和文本。

同时兼容 VTT：

- 仓库中已经存在 `Episode 1 A.sentences.vtt` 样例。
- VTT 是浏览器生态中的标准字幕格式。
- 兼容 VTT 可以降低用户转换成本。

内部统一结构：

```js
{
  id: "1",
  start: 4.232,
  end: 16.368,
  text: "ESLPod.com presents ..."
}
```

## 3. 现有代码接入点

预计主要改动以下位置：

- `src/js/app/input.js`：当前音频/视频上传入口，可参考其文件上传交互。
- `src/js/app/init.js`：播放器创建完成后绑定 UI 的入口。
- `src/js/app/player/player.js`：播放器统一封装，已有 `getTime()`、`setTime()`、`play()`、`pause()`；本功能需要增加“直接播放不自动后退”的路径。
- `src/js/app/ui.js`：顶部播放器按钮和快捷键绑定逻辑。
- `src/js/app/settings/defaults.json`：默认快捷键配置。
- `src/js/app/settings/KeyboardShortcuts.jsx`：快捷键设置页动态读取 defaults，可复用。
- `src/html/topbar.htm`：顶部播放器控制栏结构。
- `src/html/textbox.htm`：可放置字幕上传按钮和当前字幕显示区域。
- `src/l10n/_english.ini` 以及其他语言文件：新增 UI 文案 key。
- `src/scss/controls.scss` / `src/scss/textbox.scss`：新增按钮和字幕显示样式。

## 4. 新增模块设计

建议新增模块：

```text
src/js/app/subtitles.js
```

模块职责：

- 读取 `.srt` / `.vtt` 文件。
- 解析字幕为标准 cue 列表。
- 维护当前字幕状态。
- 根据播放器时间查找当前句。
- 提供上一句、下一句、重复当前句、字幕显示开关、语句播完暂停开关等 API。
- 管理重复播放和语句结束自动暂停的结束检测。

建议状态结构：

```js
{
  cues: [],
  filename: "",
  currentIndex: -1,
  showCurrentText: true,
  pauseAtSentenceEnd: false,
  repeatActive: false,
  repeatCueIndex: -1,
  repeatTimer: null,
  displayTimer: null,
  sentenceEndTimer: null,
  activeSentenceIndex: -1
}
```

建议导出 API：

```js
loadSubtitleFile(file): Promise
clearSubtitles()
hasSubtitles(): boolean

getCueAt(time): Cue | null
getCurrentCue(player): Cue | null
getCurrentIndex(player): number

jumpToPrevious(player)
jumpToNext(player)
repeatCurrent(player)

setSubtitleVisible(visible)
toggleSubtitleVisible()
setPauseAtSentenceEnd(enabled)
togglePauseAtSentenceEnd()
bindSubtitleDisplay(player)
bindSentenceEndPause(player)
```

## 5. 播放器 API 调整

当前 `Player.play()` 会先调用 `this.skip('backwards')`，再调用底层 driver 的 `play()`。这个行为适合人工转写时的普通播放，但不适合字幕语句控制，因为上一句、下一句、重复当前句都需要从字幕 cue 的精确开头播放。

本功能需要新增一种“直接播放不自动后退”的路径，并且本次所有新增字幕功能都必须使用该路径。

建议在 `src/js/app/player/player.js` 中新增方法：

```js
playDirect(){
  this.driver.play();
}
```

保留现有 `play()` 行为不变：

```js
play(){
  this.skip('backwards');
  this.driver.play();
}
```

使用规则：

- 现有播放/暂停按钮和原有 `ESC` 快捷键继续使用 `player.play()`，保持旧体验。
- 上一句跳转后使用 `player.playDirect()`。
- 下一句跳转后使用 `player.playDirect()`。
- 重复当前句从句首开始时使用 `player.playDirect()`。
- “语句播完暂停”打开后，用户通过上一句/下一句进入目标句时，也使用 `player.playDirect()`。
- 上传字幕、显示/隐藏字幕、切换语句播完暂停本身不触发播放。

如果未来还有其他精确时间轴功能，也应优先使用 `playDirect()`，避免被转写场景的自动回退逻辑影响。

## 6. 字幕解析规则

SRT 示例：

```text
1
00:00:04,232 --> 00:00:16,368
Sentence text
```

VTT 示例：

```text
WEBVTT

00:00:04.232 --> 00:00:16.368
Sentence text
```

解析规则：

- 时间统一转为秒。
- SRT 的 `,` 和 VTT 的 `.` 毫秒分隔符都要支持。
- 支持 `HH:MM:SS,mmm`、`HH:MM:SS.mmm`、`MM:SS.mmm` 等常见形式。
- 多行字幕文本合并为一行，使用空格连接。
- 忽略空 cue 和无法解析时间的 cue。
- cue 按 `start` 升序排序。
- 如果字幕有重叠，当前时间命中多个 cue 时优先选择第一个。
- 如果当前时间位于两个 cue 的间隙，“当前句”定义为已经开始且离当前时间最近的上一条 cue。

错误处理：

- 文件格式不支持时提示只支持 `.srt` / `.vtt`。
- 文件读取失败时显示读取错误。
- 无有效字幕时提示字幕文件未解析到可用时间轴。
- 未上传字幕时点击句子控制按钮，提示用户先上传字幕文件。

## 7. UI 设计

### 7.1 字幕上传入口

建议将字幕上传入口放在正文底部工具栏，和 import/export 同级。

按钮建议：

- 文案：`Subtitles`
- icon：`fa-cc` 或 `fa-file-text-o`
- input：`accept=".srt,.vtt,text/vtt"`

上传成功后：

- 按钮进入 active 状态。
- 可显示或 tooltip 展示字幕文件名。
- 顶部语句控制按钮变为可用。
- 在字幕上传入口附近显示两个字幕相关开关：
  - 显示/隐藏当前字幕。
  - 语句播完暂停。

重新上传字幕时：

- 替换旧字幕。
- 清除重复播放状态。
- 根据当前播放时间立即刷新当前句显示。

### 7.2 字幕开关

“显示/隐藏当前字幕”和“语句播完暂停”不放在顶部播放器控制栏。它们属于字幕模式设置，建议放在字幕上传入口附近，和字幕文件状态形成一个小的字幕工具区。

建议位置：

- `src/html/textbox.htm` 的底部工具栏中，与 `Subtitles` 上传按钮相邻。
- 或字幕上传成功后，在当前句字幕显示区域旁边/下方显示轻量开关。

控件建议：

- 显示/隐藏当前字幕：使用 checkbox/toggle，文案为 `Show current subtitle`。
- 语句播完暂停：使用 checkbox/toggle，文案为 `Pause at sentence end`。

交互规则：

- 两个开关在未上传字幕时可禁用，或保留可切换但显示为“上传字幕后生效”。建议第一版采用禁用状态，避免用户误解。
- 上传字幕后，开关恢复可用。
- 重新上传字幕时保留用户的开关选择。
- 点击开关不影响当前播放位置。
- “显示/隐藏当前字幕”只控制字幕文本展示，不影响上一句、下一句、重复播放和语句播完暂停。
- “语句播完暂停”只影响普通播放和句子跳转后的播放，不改变“重复当前句播放完始终暂停”的行为。

### 7.3 顶部语句控制按钮

建议在顶部播放器控制栏中只放高频播放操作按钮，放在现有快退/快进按钮之后。

推荐顺序：

1. 播放/暂停
2. 快退
3. 快进
4. 上一句
5. 下一句
6. 重复当前句
7. 速度
8. 进度条
9. 时间
10. 重置

按钮建议：

- 上一句：`fa-step-backward`
- 下一句：`fa-step-forward`
- 重复当前句：`fa-repeat`

无字幕时：

- 控制按钮应显示为不可用或淡化。
- 点击时给出明确提示。

### 7.4 当前句字幕显示

建议在编辑区内、文本框上方增加当前句字幕显示区域：

```html
<div class="subtitle-current hidden"></div>
```

视觉规则：

- 不遮挡正文输入区域。
- 宽度与 `#textbox` 尽量对齐。
- 长句可换行。
- 开关关闭时隐藏。
- 没有当前 cue 时隐藏。
- 上传字幕但当前播放时间没有对应 cue 时隐藏。

刷新机制：

- 播放时每 100ms 到 250ms 检查一次 `player.getTime()`。
- 当前 cue index 变化时更新 DOM。
- 暂停时保留当前句显示，除非用户关闭字幕显示。

## 8. 语句跳转逻辑

### 8.1 上一句

行为：

- 如果当前时间位于某句内部，并且已经播放超过当前句时间跨度的一半，则跳到当前句开头。
- 如果当前时间位于当前句的前半段，则跳到上一句开头。
- 如果当前时间位于间隙，则跳到已经开始且离当前时间最近的上一句开头。
- 跳转后调用 `player.playDirect()`，避免自动后退影响句首定位。

边界：

- 当前已经是第一句时，跳到第一句开头并播放。
- 无字幕时提示用户上传字幕。

### 8.2 下一句

行为：

- 如果当前时间位于某句内部，跳到下一句开头。
- 如果当前时间位于间隙，跳到下一个 `start > currentTime` 的 cue。
- 跳转后调用 `player.playDirect()`，避免自动后退影响句首定位。

边界：

- 当前已经是最后一句时，跳到最后一句开头并播放，或保持当前句不变。建议第一版采用“保持最后一句并播放”，避免无反馈。
- 无字幕时提示用户上传字幕。

### 8.3 重复当前句

行为：

- 找到当前 cue。
- 跳到 `cue.start`。
- 调用 `player.playDirect()`，确保从当前 cue 开头精确播放。
- 轮询播放器时间，到达 `cue.end` 时：
  - 调用 `player.pause()`。
  - 清除 repeat 状态。
  - 保持播放头在句尾附近。
- 该行为不受“语句播完暂停”开关影响；重复当前句播放完后始终自动暂停。

如果重复播放期间用户执行其他跳转、暂停、上传新字幕或重置媒体：

- 取消当前 repeat 状态。
- 清除 repeat timer。

推荐使用轮询实现结束检测，因为当前播放器抽象层没有统一暴露 `timeupdate` 事件接口，而 `getTime()` 对 HTML5 audio、HTML5 video 和 YouTube 都可用。

### 8.4 语句播完暂停

行为：

- 用户打开“语句播完暂停”开关后，普通播放也会受到当前字幕 cue 的结束时间约束。
- 当播放器进入某个 cue 时，记录该 cue 为 active sentence。
- 播放时间到达 active sentence 的 `end` 后：
  - 调用 `player.pause()`。
  - 清除本次 active sentence。
  - 播放头保持在句尾附近。
- 用户再次播放时，如果播放头仍在句尾附近，系统应根据当前位置选择下一条 cue，避免立即再次暂停。

与其他控制的关系：

- 点击“下一句”后，从下一句开头播放，并在该句结束时自动暂停。
- 点击“上一句”后，从目标句开头播放，并在该句结束时自动暂停。
- 点击“重复当前句”时，重复播放的结束暂停优先；即使“语句播完暂停”关闭，重复当前句仍会在句尾暂停。
- 用户手动暂停时，不应额外触发句尾暂停逻辑。
- 用户拖动进度条或使用时间跳转后，下一次播放时应重新计算 active sentence。

实现建议：

- 复用字幕显示刷新或独立轮询，每 100ms 到 250ms 检查一次 `player.getTime()`。
- 只有 `player.getStatus() === 'playing'` 且 `pauseAtSentenceEnd === true` 时才检测。
- 为避免浮点和 seek 精度问题，建议在 `time >= cue.end - 0.05` 时暂停。
- 为避免刚从句尾继续播放时立即暂停，可设置一个很小的容差：如果当前时间已经超过 cue end，则选择下一条 `start > currentTime` 的 cue 作为 active sentence。

## 9. 快捷键设计

在 `src/js/app/settings/defaults.json` 中新增：

```json
{
  "previousSentence": ["a"],
  "nextSentence": ["d"],
  "repeatSentence": ["s"],
  "toggleSubtitle": ["mod+shift+c"],
  "togglePauseAtSentenceEnd": ["mod+shift+p"]
}
```

说明：

- `A` / `D` / `S` 分别对应上一句、下一句、重复当前句。
- 这三个快捷键便于左手操作，适合频繁做语句级听写控制。
- 需要确认这些单键快捷键不会明显干扰正文编辑。当前 `#textbox` 带有 `mousetrap` class，Mousetrap 允许在编辑区内捕获快捷键；实现时需要确保用户输入正文时不会意外触发语句控制。
- 设置页会动态读取 defaults 中的快捷键 key，因此新增 key 后会自动出现在快捷键设置列表中。

需要新增 l10n key：

```ini
previousSentence = Previous sentence
nextSentence     = Next sentence
repeatSentence   = Repeat sentence
toggleSubtitle   = Show/hide current subtitle
togglePauseAtSentenceEnd = Pause at sentence end
subtitles         = Subtitles
upload-subtitles  = Upload subtitles
subtitle-error    = Could not read this subtitle file.
subtitle-empty    = No usable subtitle cues were found.
subtitle-required = Upload a subtitle file first.
```

## 10. 数据持久化

第一版不建议持久化字幕内容。

原因：

- 字幕文件可能较大。
- 当前 oTranscribe 使用 localStorage，本身容量有限。
- 浏览器安全限制下，本地文件不能在下次打开时自动重新读取。
- 当前 `.otr` 格式主要保存转写文本和媒体引用，强行嵌入字幕会改变文件职责。

建议持久化：

- 最近字幕文件名，仅用于 UI 提示。
- 当前字幕显示开关状态，可放入 settings。
- 语句播完暂停开关状态，也放入 settings：

```json
{
  "subtitles": {
    "showCurrentText": true,
    "pauseAtSentenceEnd": false
  }
}
```

不建议第一版自动恢复字幕内容。用户重新打开页面后需要重新上传字幕文件。

## 11. 重置与媒体切换行为

当用户点击 reset 或重新上传媒体时：

- 清空当前字幕 cues。
- 隐藏当前句字幕。
- 关闭 repeat 状态。
- 清除 display / repeat timer。
- 清除语句播完暂停的 active sentence 和 timer。
- 字幕上传按钮恢复未激活状态。
- 语句控制按钮变为不可用或点击提示上传字幕。

当用户上传新的字幕文件时：

- 替换旧字幕 cues。
- 清除 repeat 状态。
- 清除语句播完暂停的 active sentence。
- 立即基于当前播放时间刷新当前句显示。
- 保留用户的“显示/隐藏字幕”开关选择。
- 保留用户的“语句播完暂停”开关选择。

## 12. 测试计划

### 12.1 手动测试

- 上传音频文件后，原有播放、暂停、快退、快进行为不受影响。
- 上传 `Episode 1 A.sentences.srt` 后，当前句字幕随播放进度变化。
- 上传 `Episode 1 A.sentences.vtt` 后，表现与 SRT 一致。
- 点击“下一句”跳到下一条 cue 开头并播放。
- 点击“上一句”符合“当前句前半段跳上一句、后半段回当前句开头”的逻辑。
- 点击“重复播放”只播放当前 cue，到达结束时间后自动暂停。
- 上一句、下一句、重复当前句播放时不会触发现有 `player.play()` 的自动后退。
- “语句播完暂停”关闭时，普通播放跨过当前 cue 后继续播放。
- “语句播完暂停”打开时，普通播放到当前 cue 结束时间后自动暂停。
- 打开“语句播完暂停”后，上一句/下一句跳转播放也会在目标句结束时自动暂停。
- 关闭字幕显示后，当前句字幕隐藏，但跳转功能仍可用。
- 重新上传媒体后，字幕状态清空。
- 上传非法字幕文件时显示错误提示。
- 快捷键和按钮行为一致。
- 在无字幕状态下点击语句控制按钮时，提示用户先上传字幕。

### 12.2 单元测试建议

- SRT 时间解析。
- VTT 时间解析。
- 多行字幕合并。
- cue 排序。
- 当前 cue 查找。
- 间隙中的上一句/下一句计算。
- 第一条和最后一条 cue 边界。
- repeat 到达结束时间后的暂停逻辑。
- 语句播完暂停开关打开/关闭时的普通播放行为。

## 13. 实施顺序建议

1. 新增 `subtitles.js`，完成字幕解析和 cue 查询逻辑。
2. 在 `Player` 中新增 `playDirect()`，保留原有 `play()` 自动后退行为。
3. 新增字幕上传按钮、字幕工具区开关和当前句字幕显示区域。
4. 在 `bindPlayerToUI()` 中绑定顶部上一句、下一句、重复当前句按钮；在字幕工具区绑定显示开关和语句播完暂停开关。
5. 确保本次所有字幕相关播放都调用 `player.playDirect()`。
6. 新增快捷键 defaults 和 l10n key。
7. 新增样式。
8. 使用仓库中的 SRT / VTT 样例手动验证。
9. 补充解析和导航逻辑测试。

## 14. 风险与待确认问题

- `A` / `D` / `S` 是单键快捷键，需要重点确认它们在正文编辑时的触发策略，避免用户输入文字时误触发语句控制。
- 需要确保所有新增字幕播放路径都使用 `playDirect()`，否则句首跳转会受到现有自动后退逻辑影响。
- YouTube 播放器的 seek 精度和暂停时机可能与 HTML5 audio/video 有差异，repeat 停止逻辑需要分别测试。
- 多语言文件较多，第一版可先补 `_english.ini` 和中文相关文件，其他语言回退英文或后续补齐。
- 如果未来希望 `.otr` 文件包含字幕，需要单独设计文件格式扩展和向后兼容策略。
