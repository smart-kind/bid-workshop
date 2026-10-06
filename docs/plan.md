# Bid Workshop — 交接文档

> 本文档自包含。读完即可接手，不需要再翻原始 genoffice 仓库的设计文档。
> 如需更深细节，原始设计文档在 `vendor/genoffice/` 对应的上游仓库 `gen-document` 的 `design-docs/` 下。
>
> **2026-10-05 修订**：上一版的「关键 genoffice API」和「当前状态」两节与代码不符，已按实际源码更正。
> 修订记要见文末「修订记录」。凡本文档写下的 API 名，都已在源码中核实过。

---

## 这是什么

Bid Workshop 是一个**标书审查桌面应用**。用户导入标书（Word .docx），AI 自动审查，审查结果直接以 **Word 批注**的形式写回文档——用户打开 Word 就能看到带批注的标书。

技术路线：用 pi-gui（Electron AI 壳）做外壳，把 genoffice 的 docx-engine 当文档部件嵌入，AI 通过 genoffice 的 API 控制 Word 文档。

GitHub: `smart-kind/bid-workshop`，当前分支 `main`（不是 `feat-workspace`——`feat-workspace` 是上游 `gen-document` 仓库的分支名，两者容易混）。

---

## 架构决策

**为什么 fork pi-gui 而不是用 genoffice 主体？**
genoffice 是一个文档编辑器，AI 能力是后来加的补丁。标书审查需要一个以 AI Agent 对话为核心的壳，Word 编辑只是其中一个部件。pi-gui 正好是这种壳——Electron + pi-agent SDK + 工具调用 + 会话管理。

**为什么 genoffice 是"部件"而不是"主体"？**
genoffice 的价值在于它的 docx-engine：能解析 .docx、能渲染、能通过 API 插入批注。这些能力被当作组件引入 bid-workshop，而不是让 bid-workshop 变成 genoffice 的一个插件。

> ⚠️ **这个决策需要重新论证一次。** 上游现已存在 `apps/workspace-shell`（`@genoffice/workspace-shell`），自我描述为
> "Goal-driven document workspace shell: workspace selector, file tree, conversation list and an agent-driven chat panel around the editor apps' WebContentsView factories"
> ——即「工作空间选择器 + 文件树 + 会话列表 + agent 对话面板」，正是本文档第 5 步想建的壳，而且已经建好了。
> 更关键的是它依赖的 `@genoffice/workspace-harness` 是一个**零 Electron 依赖**的无头包，里面已经实现了本文档第 1–4 步的绝大部分（见下节「漏掉的一层」）。
> 「genoffice 只是文档编辑器、AI 是补丁」这句话对 genoffice 主体的判断成立，但**对 upstream 的 workspace-shell + workspace-harness 不成立**。
> 在动手写第 2 步之前，必须先回答：为什么不直接用/复用 workspace-harness，而要自己重写一套？

**组件来源：**

| 能力                                        | 来源                              | 位置                                           | 状态                              |
| ------------------------------------------- | --------------------------------- | ---------------------------------------------- | --------------------------------- |
| Electron 桌面壳 + AI Agent                  | pi-gui fork                       | `apps/desktop/`                                | ✅ 已引入                         |
| Word 文档解析                               | genoffice `file-parse`            | `vendor/genoffice/file-parse` (symlink)        | ✅ 已引入（仅纯文本提取）         |
| Word 渲染/编辑/批注                         | genoffice `docx-engine`           | `vendor/genoffice/docx-engine` (symlink)       | ✅ 已引入（**但项目代码零引用**） |
| HTML→DOCX 转换                              | genoffice `html2docx`             | `vendor/genoffice/html2docx` (symlink)         | ✅ 已引入                         |
| 字体度量                                    | genoffice `font-metrics`          | `vendor/genoffice/font-metrics` (symlink)      | ✅ 已引入                         |
| 国际化                                      | genoffice `i18n`                  | `vendor/genoffice/i18n` (symlink)              | ✅ 已引入                         |
| 幻灯片引擎                                  | genoffice `pptx-engine`           | `vendor/genoffice/pptx-engine` (symlink)       | ✅ 已引入（上一版本文档漏记）     |
| **工作空间模型 + 文档/批注工具 + 审查工具** | **genoffice `workspace-harness`** | `vendor/genoffice/workspace-harness`（已入库） | ✅ 已引入（子路径取用）           |
| 无头文档 CLI（调试用）                      | genoffice `cli`                   | 未引入（上游 `packages/cli`，bin `genoffice`） | ❌ 未引入                         |
| 标书审查业务逻辑                            | 本项目                            | `extensions/bid-review/`                       | ✅ 已实现（第 2–4 步）            |

`vendor/genoffice/` 下的包**源码已直接入库并纳入版本控制**（不再是软链），所以
`git clone && pnpm install && pnpm build` 在任何人、任何机器上都跑得通，不需要上游 checkout。
更新方式：`node scripts/sync-genoffice.mjs <上游 feat-workspace 路径>`——它是朴素的文件复制，
结果会出现在 `git status` 里，可以像普通改动一样评审。许可证（`LICENSE` / `NOTICE` / `LICENSE-UNICODE.txt`）随代码一起入库。

---

## 漏掉的一层：workspace-harness

上一版本文档完全没有提到这个包，而它**正是本文档第 1–4 步的上游实现**。

`@genoffice/workspace-harness`（上游 `packages/workspace-harness`）自述：

> "Goal-driven document workspace harness: tool registry with effect dispatch, workspace + read-only reference storage, pi-agent host (**no Electron dependency**)"

已核实其 `package.json` 依赖仅为 `pi-agent-core`、`pi-ai`、`agent-core`、`ai-provider`、`docx-engine`、`pptx-engine`、`xlsx-gateway`、`typebox`——**源码中零 `electron` 引用**，可在无头 / 非 Electron 环境直接使用。

它包含的东西，和本文档的对应关系：

| workspace-harness 里的实现                                                                       | 对应本文档                                  |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `workspace/manifest.ts` — manifest.json 读写（schemaVersion/goal/references/documents/vcs/demo） | §核心概念「工作空间」提出的 manifest.json   |
| `workspace/zones.ts` — 四区模型，`READ_ONLY_ZONES` + `isReadOnlyPath()` 在工具层强制只读         | §设计哲學「只读引用资料是硬约束」           |
| `workspace/references.ts` — `ReferenceStore`，把外部目录挂载进工作空间                           | §核心概念 `references/`                     |
| `workspace/documents.ts`、`store.ts`、`git.ts`、`conversations.ts`                               | 文档注册、版本、会话                        |
| `tools/document.ts`、`document-edit.ts`                                                          | 第 2、4 步的文档读写与批注                  |
| `tools/review.ts` — `review_write_findings`                                                      | **第 3 步的审查结论模型**                   |
| `tools/ui.ts` — `ui_open_document` 等                                                            | 第 5 步的编辑器联动                         |
| `workspace/demo.ts` — `ensureDemoWorkspace()` / `provisionDemoWorkspace()`                       | **第 1 步的样例工作空间（已有可抄的实现）** |
| `agent/host.ts` — pi-agent host，无 Electron                                                     | 第 3 步的 Agent 运行时                      |

特别值得看 `tools/review.ts:139` 的 `review_write_findings`，它的参数 schema 几乎就是本文档第 3 步定义的结论结构：

```
{ document, findings: [{ id, check, basis, location, quote?, finding, advice? }],
  skillId?, skillVersion?, model? }
```

其中 `basis` 的示例是「招标文件 3.2 签字盖章」、`location` 的示例是「产出/投标文件.docx#块42」——**这是照着标书审查场景写的**。也就是说：第 3 步的结论模型不用自己设计，上游已有，并且 `location` 用的是「工作空间相对路径 + `#块N`」这种锚定写法。

**结论**：第 1–4 步的大部分不是「从零做」，而是「决定复用还是重写」。这是个必须显式做的架构决策，不能默认从零写。

`workspace-harness` 的完整工具清单（`grep "name: '" src/tools/`，已核实）：

```
doc_add_comment   doc_apply_ops      doc_insert_content  doc_read_blocks
doc_read_comments doc_read_live      doc_replace_blocks  review_write_findings
fs_add_document   fs_add_reference   fs_delete           fs_export
fs_import         fs_list            fs_list_references  fs_move
fs_read_text      fs_remove_reference fs_rename          fs_write_text
slide_apply_ops   slide_read_deck    ui_activate_document ui_close_document
ui_get_language   ui_get_theme       ui_list_open_documents ui_notify
ui_open_document  ui_set_language    ui_set_theme        ui_toggle_panel
version_commit    version_log        version_status     workspace_create
workspace_delete  workspace_describe workspace_get_settings workspace_list
workspace_open    workspace_set_settings workspace_update
```

注意：`doc_*` 这一组是**活编辑器工具**，要求文档已在编辑器里打开（`document-edit.ts:271` 会返回 "not open in the editor. Use ui_open_document to open it first"），**不是无头文件 API**。

---

## 核心概念

### 工作空间（Workspace）

一个工作空间 = 磁盘上一个文件夹 = 一个 git 仓库。

> ⚠️ **上一版这里的目录结构图是错的**，它写的是 `references/` + 根目录直接放 `标书.docx` + `.workspace/sessions/`。
> 上游 workspace-harness 采用**四区模型**（`workspace/zones.ts`），目录名是中文，且写入权限由工具层按区强制：

```
<workspace>/
├── .workspace/
│   └── manifest.json          # 工作空间元数据（元数据目录，不属任何区）
├── 引用/                       # library  — 只读：挂载的共享资料，多个工作空间共用
├── 资料/                       # material — 只读：本项目专属的输入（招标要求、评审规则等）
├── 产出/                       # output   — 可写：本工作空间产出的文档
└── 意见/                       # feedback — 可写：审阅者对产出文档的零散意见
```

只读是硬约束，且在工具层实现（`READ_ONLY_ZONES = ['library', 'material']`，`isReadOnlyPath()`）——不是靠文档规定，而是靠代码拒绝。

**是否采用这个四区模型，是上面那个「复用 vs 重写」决策的一部分。** 若决定自建，需要说明为什么不沿用。

### 批注是输出

AI 审查的结果不是生成一份新报告，而是直接在 Word 文档里加批注。批注锚定到具体段落或文字 span，用户打开 Word 就能看到问题在哪里。

---

## 关键 genoffice API（已按源码更正）

> 上一版把这一组 API 说成「全部来自 docx-engine 和 file-parse」，**这是错的**。
> 其中 6 个来自 `workspace-harness`（未引入），4 个在整棵上游仓库里根本不存在。

### 名字不存在的 API

以下四个名字在上游 `packages/` 全树搜索**零命中**，上一版文档是凭空写的：

| 上一版写的            | 实际情况                                         |
| --------------------- | ------------------------------------------------ |
| `doc_reply_comment`   | 不存在。能力只以 CLI 操作名 `reply_comment` 存在 |
| `doc_resolve_comment` | 不存在。同上，CLI 操作名 `resolve_comment`       |
| `doc_delete_comment`  | 不存在。同上，CLI 操作名 `delete_comment`        |
| `doc_get_context`     | 不存在，任何地方都没有                           |

### docx-engine 真实可用的 API

`vendor/genoffice/docx-engine/src/index.ts` 导出（已逐条核对）：

```ts
parseDocx(bytes: Uint8Array, options?: ParseOptions): Promise<ParsedDocFull>   // parse.ts:306
saveDocx(parsed: ParsedDocFull, finalBlocks: SaveBlock[], options?: SaveOptions): Promise<Uint8Array>  // patch.ts:349
scanBody(...), buildBlankDocx(...), readSections(...), readSectionSettings(...), ...
```

`file-parse` 的真实导出只有文本提取：`parseFileToText` / `docToText` / `docxToText` / `pptToText` / `pptxToText` / `xlsxToText` / `pdfToText`。**没有批注 API。**

#### 批注的真实模型（这条最关键）

批注的支持是**真实存在**的，但和上一版描述的形式完全不同：

- 读：`parseDocx` 会解析 `word/comments.xml` + `word/commentsExtended.xml`（`parse-package.ts:76-99`），结果挂在 `ParsedDoc.comments`
- 类型：`CommentInfo`（`types.ts:252`）
  ```ts
  { id, author, initials?, date?, text, parentId?, done?, paraId? }
  ```
  `parentId` 表示回复关系，`done` 表示已解决——**回复和已解决是数据字段，不是独立 API**
- 写：`saveDocx` 的 `SaveOptions.comments?: CommentInfo[]`（`patch.ts:202`）

  > "Full desired comment list; word/comments.xml is regenerated from it"

  即**整份批注列表全量重写**，不是「逐条 add」。想加一条批注 = 读出现有列表 + 追加 + 整体传回。

- 锚定：`commentIds?: string[]` 挂在 **run** 上（`types.ts:127`），不是 block：

  > "ids of comments whose range covers this run. Only set when the whole commentRangeStart..End pair lives inside the same paragraph"

  即锚定粒度是**段落内的 run 范围**，且**要求 commentRangeStart..End 落在同一段落内**。上一版说的「锚定到 block：指定 blockIndex / 锚定到 text span：指定文本范围」是对 **CLI / workspace-harness 工具层**的描述，不是引擎层的。

- 写出锚点：`generate.ts:2325-2345`（`runsXml`）按 run 的 `commentIds` 首末位置生成 `<w:commentRangeStart/>` / `<w:commentRangeEnd/>` / `<w:commentReference/>`

**因此第 4 步的实现路径是**：在目标 run 上挂 `commentIds`，同时把 `CommentInfo[]` 传给 `saveDocx(parsed, blocks, { comments })`，而**不是**调 `doc_add_comment`。
这条路已实测跑通，见下面「2026-10-05 实测结果」。

### workspace-harness 的工具（需先解决 SDK 版本冲突）

`doc_read_blocks`、`doc_read_comments`、`doc_insert_content`、`doc_replace_blocks`、`doc_apply_ops`、`doc_add_comment` 这 6 个名字**真实存在**，但在 `workspace-harness/src/tools/` 下，**不在 docx-engine/file-parse**。且如上所述是活编辑器工具。

### CLI 命令（真实存在，但 CLI 未引入、不在 PATH）

上一版这一节是**对的**。`@genoffice/cli`（上游 `packages/cli`，bin 名 `genoffice`）确有：

- `genoffice docs <read|apply|check> <file.docx>`（`cli/src/commands/docs.ts:34`）
- `docs read --comments` —— 列出每条批注的 id/作者/日期/父 id/锚定块与文本/解决状态（`commands/docs.ts:44-48`）
- `docs apply --ops <json>` —— 接受 `add_comment` / `reply_comment` / `resolve_comment` / `delete_comment`（`formats/docx.ts:433-437`）
- `docs check` —— 校验文档，连未解决的批注线程都会报告

CLI 层的 `add_comment` 描述正是上一版写的那个锚定语义：

> "new thread on a block, or on an exact text span inside it (occurrence picks one of several matches); the document text is untouched; author defaults to "AI Assistant""

注意：CLI 包**没有 symlink 进 vendor**，`genoffice` **不在 PATH**。要用得走子进程并指向上游路径。

### 取用方式：三条路

| 路线                      | 做法                                            | 优点                                    | 代价                                                                 |
| ------------------------- | ----------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| A. 直接调引擎             | 引入 `docx-engine`，用 `parseDocx` / `saveDocx` | 无头、依赖最少、**已实测跑通**（见下）  | 批注需自己把段落转成 generated 块并忠实带上格式                      |
| B. 复用 workspace-harness | 把 `workspace-harness` symlink 进 vendor        | 工作空间/四区/只读约束/审查结论模型现成 | **当前 import 不进去**（SDK 版本冲突，见下）；`doc_*` 是活编辑器工具 |
| C. 子进程调 CLI           | 起 `genoffice docs apply --ops`                 | 零集成、调试期最省事                    | 依赖上游绝对路径、不在 PATH、每次 fork 进程                          |

### 2026-10-05 实测结果

**已完成的引入**：`workspace-harness` 及其依赖（`agent-core`、`ai-provider`、`xlsx-gateway`）已按既有方式 symlink 进 `vendor/genoffice/`（`scripts/link-genoffice.mjs` 的包清单已更新），pnpm 认作 workspace 项目，`extensions/bid-review` 已声明 `@genoffice/docx-engine` 与 `@genoffice/workspace-harness` 为依赖。

**✅ 已解决：SDK 版本冲突已绕开（改为子路径取用）**

- 冲突本身真实存在：`workspace-harness` 锁 `@earendil-works/pi-agent-core@0.87.1` 与 `@earendil-works/pi-ai@0.87.1`，
  本项目（pi-gui fork）是 **1.0.0**。实测 `import '@genoffice/workspace-harness'`（包入口）失败：
  `does not provide an export named 'estimateContextTokens'`
- 耦合范围**有界**——只有 `src/agent/` 下 5 个文件 import `@earendil-works`
  （`adapt.ts` / `convert.ts` / `effect-dispatch.ts` / `host.ts` / `stream-fn.ts`）。
  `src/workspace/*` 与 `src/tools/*`（含 `review_write_findings`、`doc_add_comment`）**完全不依赖**它，只用 `typebox` 和 `node:fs/path`。

**解法（已实施）**：在上游 `packages/workspace-harness/package.json` 的 `exports` 里加子路径映射，把 agent 层排除在取用面之外：

```json
"exports": {
  ".": "./src/index.ts",
  "./workspace/*": "./src/workspace/*.ts",
  "./tools/*": "./src/tools/*.ts",
  "./tool/*": "./src/tool/*.ts"
}
```

**已实测通过**（从本项目 import，esbuild 打包 242.9kB，对比拖入 agent 层的 2.2mB）：

- `@genoffice/workspace-harness/workspace/manifest` → `createManifest` / `readManifest` / `writeManifest`，创建→写入→读回往返正确
- `@genoffice/workspace-harness/workspace/zones` → 四区模型正确，`引用`/`资料` 判为只读、`产出`/`意见` 判为可写
- `@genoffice/workspace-harness/tools/review` → 导出 `createReviewToolSet` 及 `REVIEW_SEVERITIES` / `REVIEW_VERDICTS` / `REVIEW_DISPOSITIONS`
- 全程没有触发 pi-agent-core 的版本错误 → agent 层确实未被拖入

> ⚠️ 这个 `exports` 改动目前**只在上游工作树里、尚未提交**（`/Users/david/orca/workspaces/gen-document/feat-workspace`，
> 分支 `feat-workspace`）。上游仓库当时有大量在途未提交改动，所以没有替你提交。
> 换机器或重新 clone 上游后，需要重新应用这个改动，否则子路径 import 会退回 `ERR_PACKAGE_PATH_NOT_EXPORTED`。

**✅ 已验证通过：无头写批注可行，不需要 Tiptap 编辑器**

实测往返（`buildBlankDocx` → 构造 generated 块 → `saveDocx` → 重新 `parseDocx`）：

- 把批注 id 挂在 run 上：`{ kind: 'generated', block: { type: 'paragraph', runs: [{ text: '…', commentIds: ['1'] }] } }`
- 同时传 `saveDocx(parsed, blocks, { comments: CommentInfo[] })`
- 结果：`word/comments.xml` 生成、`commentRangeStart/End/commentReference` 锚点齐全、重新解析能读回两条批注及其作者/日期/paraId
- 机制在 `generate.ts:2325-2345`（`runsXml` 按 `commentIds` 的首末 run 生成锚点）和 `patch.ts:912-970`（重写 comments.xml）

**这意味着第 4 步不必依赖编辑器**。真正的工作量在**已有文档**上加批注时：目标段落要从 `{kind:'original', docxIndex}` 转成 `{kind:'generated', block}`，而转的时候必须忠实带上该段的格式（`rawPPr`、run 的 `rPr`、列表/书签等），否则那一段的排版会掉。上游正是用 Tiptap 编辑器模型 + `convert.pmDocToSavePlan()` 在做这个转换。

**结论**：第 2、4 步可以走无头引擎路线，且批注链路已证明可行；但「把已有段落忠实转成 generated 块」这层需要自己写或复用上游的编辑器转换层——这是第 4 步的实际难点，不是批注 API 本身。

---

## 端到端流程

```
1. 用户导入标书.docx 到工作空间
2. bid-review 扩展调用 file-parse / docx-engine 解析文档
   → 得到结构化内容：段落列表、章节结构、表格数据
3. AI Agent 拿到文档结构 + 评审条件（用户提供或默认）
4. AI 逐项分析，生成审查结论：
   - 每条结论 = { 位置(blockIndex/textSpan), 问题描述, 严重度, 建议 }
5. AI 调用 doc_add_comment 把每条结论写成 Word 批注
6. 保存后的 .docx 打开就是带批注的状态
7. 在 bid-workshop 的编辑器里也能直接看到批注效果
```

> 第 2、4、5 步的实现方式按上一节更正：第 2 步用 `parseDocx`；第 4 步的结论结构可对齐 `review_write_findings` 的 schema；
> 第 5 步用 `saveDocx({ comments })` 而非 `doc_add_comment`。

审查维度（可定制，初始样例覆盖这些）：

- 资质要求是否满足
- 报价是否合理
- 技术方案是否完整
- 法律条款是否有风险
- 格式是否合规（页码、目录、签章位置等）

---

## 当前状态

> 上一版的现状表**不可用**。它是对着 GitHub 上的提交写的，而本项目大量工作当时还躺在本地未提交，
> 因此它把「已实现」误记为「未做」。下表是核对本地工作树后的实际状态。

| 项目                                  | 状态                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| pi-gui 壳 fork 到 bid-workshop        | ✅ 已完成                                                                                           |
| 品牌改名 + 移除无关模块               | ✅ 已完成                                                                                           |
| **项目自足性（clone 即可编译）**      | ✅ **已解决**：genoffice 源码已入库并纳入版本控制，不再依赖本机软链，见下节                         |
| GitHub 仓库 (smart-kind/bid-workshop) | ✅ 已创建并推送，分支 `main`，**公开仓库**                                                          |
| bid-review 扩展                       | ✅ 已实现（mock 已被真实链路替换）                                                                  |
| workspace-harness 复用通道            | ✅ 已打通（子路径 exports，实测可 import）                                                          |
| **样例标书 .docx**                    | ✅ 已完成（`workspaces/bid-sample/投标文件-某软件科技.docx`，含 6 个埋点）                          |
| 评审条件                              | ✅ 已完成（`workspaces/bid-sample/评审条件.md`）                                                    |
| **文档加载链路**（docx → 结构化数据） | ✅ 已完成（`document.ts` + `parser-docx.mjs`，实测解析真实文档通过）                                |
| 期望输出（带批注的 .docx）            | ❌ 未做                                                                                             |
| manifest.json                         | ❌ 未做                                                                                             |
| AI 审查逻辑                           | ✅ 已完成（`review.ts` + `bid_record_findings`，模型执行审查）                                      |
| Word 批注输出                         | ❌ 未做。机制已验证可行，未接进产品                                                                 |
| UI 集成                               | ⚠️ 面板已在真实 Electron 中跑通（加载真实 .docx + 展示解析结果，有 core lane 回归）；右侧文档区未接 |

**bid-review 已有的实际代码**（已提交，`36d94cf`）：

| 文件                                                | 规模   | 内容                                                                                                                 |
| --------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `extensions/bid-review/contract.ts`                 | 47 行  | `BidReviewService` 接口定义                                                                                          |
| `extensions/bid-review/index.ts`                    | 195 行 | 3 个工具（`bid_load_document` / `bid_start_review` / `bid_export_report`）+ 命令 + desktop view 注册 + facet service |
| `extensions/bid-review/desktop.ts`                  | 375 行 | 完整面板 UI：严重度/类目筛选、进度条、统计卡、结论列表                                                               |
| `extensions/bid-review/mock-review.ts`              | 105 行 | 写实的中文审查结论样例（市政道路改造工程，5+ 条，含 critical/warning/info）                                          |
| `extensions/bid-review/scripts/build-sample-bid.ts` | —      | 样例标书生成器（`pnpm --filter @bid-workshop/extension-bid-review run build:sample-bid`）                            |

> ⚠️ **公开仓库**：`smart-kind/bid-workshop` 是 public（已核实 `isPrivate: false`）。
> 样例数据必须虚构。真实材料（客户名、合同金额、营业执照、财务报表）只存在于同级 `bid-workshop/资料/`，**不得进入本仓库**。

---

## 第 1 条：项目自足性（已完成）

**目标**：`git clone && pnpm install && pnpm build` 在任何人、任何机器上都跑得通，不依赖某个开发者本机的路径。

**原先的问题**（审计 `docs/audit-issues.md` 问题 1 也指出同一件事）：`vendor/genoffice/*` 是指向
`/Users/david/orca/...` 的软链，而 `vendor/` 被 gitignore。换台机器 clone 下来，扩展连 `@genoffice/*`
都解析不到，项目直接编译不过。

**做法**：把 genoffice 的**源码直接入库并纳入版本控制**（不是子模块——上游 `feat-workspace` 上有 41 项未提交，
子模块会拿到一个编译不过的旧快照）。具体：

| 内容                                         | 说明                                                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `vendor/genoffice/<10 个包>/`                | docx-engine / file-parse / font-metrics / html2docx / i18n / pptx-engine / agent-core / ai-provider / workspace-harness / xlsx-gateway |
| `vendor/tools/ooxml-validate/`               | pptx-engine 测试按 `../../../tools/` 找它，要保持 `packages/` 与 `tools/` 的兄弟关系                                                   |
| `vendor/tsconfig.base.json`                  | vendored 包的 `tsconfig.json` 写 `"extends": "../../tsconfig.base.json"`；缺了它 tsc 退回 target ES5 并报一堆错                        |
| `LICENSE` / `NOTICE` / `LICENSE-UNICODE.txt` | Apache-2.0 的义务，随代码一起入库                                                                                                      |
| `scripts/sync-genoffice.mjs`                 | 替代原 `link-genoffice.mjs`：从上游 checkout 复制更新，结果是可评审的文件改动                                                          |

**实测**（`pnpm install --frozen-lockfile`，即全新 clone 与 CI 走的路径）：通过。
17 个 workspace 项目、lockfile 含 10 个 vendor importer。

**同时修掉的两个坑**：

1. `.npmrc` 增加 `link-workspace-packages=true`。vendored 包内部把同族依赖写成 `"*"`，
   pnpm 10 默认不链接本地 workspace 包，会去 npm registry 找 `@genoffice/agent-core` 而失败。
   软链时代这个问题被掩盖，变成真目录后才暴露。
2. `.gitignore` 的 `*.js` 规则会吃掉 vendored 包里自带的 JS 文件，已加 `!vendor/**/*.js` 例外。

## CI 现状（重要）

**CI 从首次提交起从未通过。** 已核实 `gh run list`：`feat: initial bid-workshop project`（run 37297329248）即 `failure`，
之后每次 push 都失败。推上去时就不是绿灯状态，且有多个独立原因：

| 关卡                 | 状态    | 说明                                                                                                                        |
| -------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `format:check`       | ✅ 已修 | 曾有 17 个**既有**已提交文件不符合 Prettier（`apps/desktop/*`、`eslint.config.mjs`、`scripts/*.mjs` 等），已统一格式化      |
| `lint`               | ✅ 已修 | `extensions/bid-review` 的 typed lint 一直在找 `extensions/tsconfig.lint.json`——**该文件从未创建过**；vendored 源码也需排除 |
| `check:workspaces`   | ✅ 已修 | `extensions/bid-review` 从首次提交起缺 `typecheck` 脚本（缺 tsconfig）                                                      |
| `typecheck`          | ✅ 通过 | 16 个 workspace 全过，含全部 vendored 包与 `apps/desktop`                                                                   |
| `check:architecture` | ✅ 通过 |                                                                                                                             |

### 与 pi-gui 的发布身份尚未剥离（CI 有两步因此移除）

CI 的 `typecheck` job 原本还跑两步：`pnpm verify:install-copy` 与 `pnpm verify:release-config`。
**它们从未生效过——根 `package.json` 里根本没有这两个脚本**，所以 CI 走到这里必然
`Command not found`。这是 CI 一直红的最后一环。

接上之后才发现更深一层：它们断言的是 **pi-gui 的发行身份**——

- `scripts/verify-install-copy.mjs` 要求 README 含 pi-gui 的发行文案（`.dmg`/`.AppImage`/`.exe`、
  `brew install --cask pi-gui`）
- `apps/desktop/scripts/verify-release-config.mjs` 断言 homepage 必须等于 `github.com/minghinmatthewlam/pi-gui`、
  Linux 可执行名与 deb 包名必须是 `pi-gui`

同一身份还散落在 `scripts/homebrew-tap-utils.mjs`、`apps/desktop/scripts/verify-linux-release.sh`、
`.github/workflows/release.yml`（推送 `minghinmatthewlam/homebrew-tap`）。

**处理**：保留真正成立的检查（`verify:launcher-contract`、`verify:release-version`，后者已接到根 scripts 并通过），
**移除那两步**并在 `ci.yml` 里写明原因。把发布身份接过来（README、包元数据、Homebrew tap、release workflow）
是**独立的一块工作**，半途改会留下一条断掉的发布链。

### vendor 与 CI：已从根上解决

原先 `vendor/genoffice/*` 是 gitignore 的、指向仓库外的 symlink，于是**任何被 CI typecheck 的文件
import `@genoffice/*` 都会失败**（`apps/desktop` 也在覆盖内，挪到应用层也没用），而且 **vendor 存在时
`pnpm install --frozen-lockfile` 必失败**。现在源码已入库，两点都不再成立——详见「第 1 条：项目自足性」。

### 扩展前端 bundle 是签入的

`extensions/bid-review/dist/` 下的两个前端 bundle **签入版本控制**，与 `examples/desktop-extensions/*/dist/` 同一约定：
扩展视图的 frame 运行时直接从磁盘加载，没有构建步骤，clone 下来必须就有。

在此之前**没有任何流水线构建过它**——`apps/desktop` 的 build 不含扩展，`start-dev.sh` 只构建 shared 包，
`.gitignore` 又把它排除。这正是 core lane 测试会卡在 `data-state="mounting"` 的原因之一。
`node extensions/bid-review/build.mjs --check`（挂在 `build:check` 与 `test`）会在签入的 bundle 与源码不一致时失败。

---

## 下一步工作（按顺序）

### 第 0 步：复用 workspace-harness（已拍板，通道已打通）

**已拍板：复用 `workspace-harness`**，不再自建工作空间模型与审查结论模型。

**已完成**：

1. 包已 symlink 进 vendor（连同 `agent-core` / `ai-provider` / `xlsx-gateway`），pnpm 认作 workspace 项目，扩展已声明依赖。
2. **SDK 冲突已绕开**——上游 `exports` 加了子路径映射，可只取 `workspace/*` + `tools/*` 而不拖入锁在 0.87.1 的 agent 层。
   已实测：manifest 往返、四区只读规则、`tools/review` 导出均正常。详见「2026-10-05 实测结果」。
3. 现有未提交工作已提交为基线（`36d94cf`）。

**待办**：

1. ⚠️ 上游那个 `exports` 改动**尚未提交**（在上游 `feat-workspace` 分支的工作树里）。需要在上游仓库提交，否则换机器/重新 clone 后会失效。
2. **工作空间目录结构**——是否采用上游四区模型（`引用/资料/产出/意见`）与 `.workspace/manifest.json`。
3. **`doc_*` 工具是活编辑器工具**——`doc_add_comment` 走 `docEditBridge`，需要第 5 步的编辑器联动到位才能用；
   无头路径见「2026-10-05 实测结果」（已跑通，但需自己处理段落转换）。

### 第 1 步：建立样例工作空间（部分完成）

1. **一份样例标书** .docx — ✅ **已完成**（`757e0d9`）

   产物：`workspaces/bid-sample/投标文件-某软件科技.docx`（5 章、17 标题、3 张表），
   生成器：`extensions/bid-review/scripts/build-sample-bid.ts`，用
   `pnpm --filter @bid-workshop/extension-bid-review run build:sample-bid` 重跑。
   文档用 `buildBlankDocx` 造底 + generated 块 + `saveDocx` 落盘，表格用
   `generateTableXml` + `patchTableCellTexts`。

   **埋入的 6 个问题**（均已核实真实存在）：

   | #   | 问题           | 证据                                                                 |
   | --- | -------------- | -------------------------------------------------------------------- |
   | 1   | 报价合计错误   | 明细合计 850,000，合计却写 800,000；且文中声称「明细合计与总价一致」 |
   | 2   | 缺签章         | 「投标人（盖章）」「法定代表人或授权代表（签字）」两处为空           |
   | 3   | 技术方案缺章节 | 无「项目管理计划」「质量保证措施」                                   |
   | 4   | 工期超限       | 承诺 195 日历天，评审条件要求 ≤180                                   |
   | 5   | 证明材料未附   | 称「详见附件一/附件二」，实际无附件                                  |
   | 6   | 无页码         | 无页眉页脚、无 PAGE 域                                               |

   > ⚠️ **脱敏是硬要求**。基底材料取自同级 `bid-workshop/资料/`（真实公司简介、合同协议集），
   > 但 `smart-kind/bid-workshop` 是**公开仓库**（已核实 `isPrivate: false`）。
   > 因此产物里的公司名、客户名、合同金额**全部替换为虚构值**，「某」占位风格与仓库既有样例一致。
   > **真实材料（客户名、合同金额、营业执照、财务报表、软著证书）不得进入本仓库。**
   > 若将来需要更真实的样例，正确做法是把仓库改为 private，而不是把真实数据提交进公开仓库。

2. **一份评审条件** — ✅ **已完成**（`workspaces/bid-sample/评审条件.md`），四类维度与上面 6 个埋点一一对应。

3. **期望输出** — ❌ **未做**：一份带批注的 .docx（或运行时动态生成），展示审查效果

4. **manifest.json** — ❌ **未做**：工作空间元数据（依赖第 0 步的四区模型决策）

### 第 2 步：文档加载链路 — ✅ 已完成

- bid-review 扩展接收 .docx 文件
- 经 `document.ts` 的解析器端口调用引擎 `parseDocx`（**不是** `doc_read_blocks`）
- 提取结构化内容：**章节大纲**（带 blockIndex）、**表格**（行列 + 单元格文本）、**全文**
- 通过 `bid_load_document` 把大纲 + 正文交给 AI Agent（正文超过 60k 字截断并注明）
- 解析结果按文档 id 缓存在模块级 Map，不进 replicated state（保持可序列化）

实现拆分：`document.ts`（纯逻辑：端口、结构化总结、文本渲染）+ `parser-docx.mjs`（唯一碰引擎的适配器）。

实测：对 `投标文件-某软件科技.docx` 跑通 —— 17 个标题、3 张表（5×4 / 6×5 / 6×4，表头正确）、全文提取正常，`RESULT: PASS`。

### 第 3 步：AI 审查逻辑 — ✅ 已完成

**审查由模型做，扩展不调用 LLM。** 扩展只负责组装 brief 和接收结论：

- `bid_start_review` → 组装 **review brief**（评审条件 + 章节大纲 + 正文，超 60k 字截断）并返回给模型
- `bid_record_findings` → 模型提交全部发现，落进 state，状态转 `done`
- 面板的「开始审查」按钮走同一条 brief，并通过 `pi.sendUserMessage(brief)` 真正触发一个 agent turn

组件：

- `review.ts`：`readCriteria()` 读文档同目录的 `评审条件.md`（没有则用内置默认条件）、`buildReviewBrief()`、`toBidIssue()`
- `contract.ts` 的 `BidIssue.location` 增加了 `blockIndex` 与 `quote`，并新增 `basis`（依据），
  这样第 4 步能把批注锚到具体段落
- 删除了 `mock-review.ts` 与定时器假的进度推进

结论字段：`id` / `severity` / `category` / `title` / `description` / `section` / `blockIndex` / `quote` / `basis` / `suggestion`。
比上游 `review_write_findings` 多保留了严重度与类别（面板 UI 依赖），少了 `check`（并入 `basis`）。

实测：对样例文档组装 brief —— 读取到工作空间的 `评审条件.md`（4 个章节）、brief 3114 字、含正文与工具指引、
结论映射保留 `blockIndex=53` 与 `basis`，`RESULT: PASS`。

### 第 4 步：Word 批注输出 — ✅ 已完成

- 审查结论 → 构造 `CommentInfo[]` → `saveDocx(parsed, saveBlocks, { comments })`
- 批注锚定到 run（`commentIds`），要求 commentRangeStart..End 在同一段落内
- 保存后 .docx 带批注状态
- 在编辑器中实时看到批注 ⬅️ 这一条属于第 5 步，尚未做

实现：`docxCommentWriter`（在唯一的 `.mjs` 适配器里）+ `bid_write_comments` 工具。

**做法**：只把需要加批注的块从 `{kind:'original'}` 转成 `{kind:'generated', block}`，
其余块原样保留；转换时把 `rawPPr` / `runs[].rawRPr` / `styleId` / `list` / `bookmarks` / `sdtShell`
等所有承载格式的字段原样搬过去，保证那一段重新生成后排版不变。
表格/图片等不可重建的块不接受批注（记入 `skipped`，不误放）。

**两个必须知道的坑**（都踩过）：

1. **两处 id 必须一致**。document.xml 里的 `w:commentRangeStart w:id="N"` 与 `comments.xml` 里的
   `w:comment w:id="N"` 若对不上，引擎**会把锚点整段丢掉**——批注还在 comments.xml 里，但文档里没有锚点，
   Word 里看不到。所以现在用同一套编号。
2. **`w:id` 必须是整数**，不能用 `F-1` 这种结论编号。因此批注统一编号，
   `BidCommentWriteResult.ids` 保留「结论 id → 批注 id」的映射用于回报。

**实测（往返，`RESULT: PASS`）**：对样例标书加 4 条批注 → 4 条全部写入且可读回、
锚点精确落在预期的块（41 / 55 / 66 / 69）、且 `blocks=74 headings=17 tables=3 chars=2201`
与原文**完全一致**（正文逐字相同、表格逐字相同）——即没有破坏任何原有排版。

### 第 5 步：UI 集成 — 部分完成

- 左侧：AI 对话（pi-gui 已有）✅
- 右侧：**文档面**（扩展视图，与审查面板并列）✅ 已完成；**真正的 genoffice 编辑器（可编辑）** ❌ 未做，原因见下
- 用户看到 AI 审查过程 + 文档上实时出现的批注 ✅ 已完成（文档视图把每条结论标在对应段落旁，随审查实时出现）

**已做**：

- 第二个扩展视图 `bid-document`（`document-desktop.ts`）：渲染解析出的正文（逐块，带块序号），
  并把每条结论以其锚定的 `blockIndex` 显示为段旁批注卡（严重度 + 描述 + 建议），随 state 变化实时更新
- `bid-review` 与 `bid-document` 共用同一个 backend facet 工厂与同一个 `BidReview` 服务，两组状态天然一致
- 服务新增 `readDocument`（把正文块交给视图）与 `writeComments`（从 UI 完成写批注闭环）
- core lane 回归：`pnpm --filter @bid-workshop/desktop run test:core:bid-review`

**为什么「把 genoffice 编辑器作为部件接上」没有做**（结论有据，不是省事）：

1. **它不是一个组件，是一整个 Electron 应用**。上游 `apps/docs` 有自己 5000 行的主进程、
   自己的 preload（约 60 个方法的 `window.desktop` IPC 族）、6649 行的 `App.tsx`，
   `package.json` 里**没有 `exports`**，没有任何可复用的库入口。
2. **扩展 iframe 装不下它**。本应用的扩展视图跑在 `sandbox allow-scripts` 的 iframe 里，
   每连接 CSP 为 `connect-src 'none'`、`frame-src 'none'`、`worker-src 'none'`；
   而 docs 渲染层需要 preload 与自己的 IPC。上游是靠 **`WebContentsView`** 嵌入的，不是 iframe。
3. **Electron 大版本差**。bid-workshop 是 Electron **37**，docs/workspace-shell 是 **43**。
4. **接入代价**：按上游 workspace-shell 的做法，要在 bid-workshop 主进程里**相对路径引入 docs 主进程源码**
   并打进自己的 main bundle，注册它整套 IPC（与现有 `window.piApp` 形成两套并行 IPC 族），
   处理它模块级的全局单例（`setActiveDocsResolver`、`mainWindow`）与关闭怪癖
   （直接关 docs 的 webContents 会把 Electron UI 线程卡进原生模态循环，必须走 `teardownDocsRenderer`），
   还要再 vendor 一批包（`ui`/`electron-utils`/`project-store`/`file-store`/Tiptap/React 19/pdfjs…）。

   **这是一个跨大版本的应用移植，不是一次 UI 装配。** 半途插入会比不做更糟——它会把应用主进程拖进一个
   不确定状态。正确的下一步是**单独评估**：要么把 bid-workshop 升到 Electron 43 并移植 workspace-shell 的
   editor-host 层，要么上游先把 docs 编辑器抽成可复用包。

**另外两点事实**（写下来免得下次再踩）：

- 扩展视图的宿主只提供**一个带标签页的侧栏**，没有「右侧独立面板」这种面。想让文档与审查**并排**，
  需要改 workbench 的契约与 App 组合（`ToolRef` 是个封闭联合：`files|changes|terminal|extension`）。
  当前文档视图是与审查面板并列的另一个标签页，不是并排的第二栏。
- `docs/workspace-redesign-plan.md` 把「更多面」明确列为 P2「单独的产品/设计评审」，即当前设计不覆盖。

依赖关系：第 0 步先行且独立；第 1 步独立；第 2→3→4 步串行；第 5 步在 2-4 通了之后做。

---

## 面板为何此前从未渲染

第 5 步开工前，Electron 面的验证暴露了三处缺陷。**三处都是既有问题，不是第 2–4 步引入的**——
也就是说这块面板在真相之前**从未真正跑起来过**，「面板 UI 已有」的说法是虚的。

| #   | 缺陷                                             | 现象                                                                                                                                                        | 修法                                                                                                               |
| --- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | `build.mjs` 把 `@earendil-works/*` 标为 external | 扩展 frame 当普通文档加载、**没有 import map**，`dist/desktop.js` 里残留裸模块名 → 整个模块图不执行，iframe `<body>` 全空、面板停在 `data-state="mounting"` | 构建拆成两次：`desktop.ts` 走浏览器 + **零 external**（自包含）；`index.ts` 走 Node、保留 external；关掉 splitting |
| 2   | 面板靠 URL `?cwd=` 找文件                        | 宿主构造的 frameUrl 是 `pi-extension://<id>/` **不带 query**，且 `assetResponse` 拒绝任何 query → 传裸文件名时按应用进程目录解析 → ENOENT                   | 后端按 `ExtensionContext.cwd`（会话工作目录）解析相对路径；渲染层继续传文件名                                      |
| 3   | 面板只渲染文件名                                 | `blockCount` / `tableCount` / `sections` 在 state 里却从不显示，没有可断言的面                                                                              | 面板渲染「N 个块，M 张表，K 个标题」+ 章节大纲                                                                     |

验证：`apps/desktop/tests/core/bid-review.spec.ts`（core lane，跟真实 Electron 跑），
断言面板显示 `74 个块` / `3 张表` 与五个真实章节标题——这些数字只有真解析才会出现，mock 满足不了。

> 注意：`extensions/bid-review/dist/` 被 gitignore，全新 checkout / CI 需要先跑
> `node extensions/bid-review/build.mjs`，面板才有的加载。

---

## 设计哲学（防止走偏）

1. **灵活性优先**：不做僵化的模板系统。审查条件可定制，审查维度可扩展，输出格式灵活。
2. **批注是核心输出**：不是生成新报告，而是在原文档上标注问题。这是产品差异点。
3. **不做模板系统**：这是 genoffice 上游的刻意决策——参考 7 页做成 13 页是允许的，格式本来就不该固定。
4. **只读引用资料是硬约束**：引用目录下的文件通过软链接引入，对工作空间只读，**工具层必须拒绝写入**。
   > 上游 `workspace-harness/src/workspace/zones.ts` 已有实现（`READ_ONLY_ZONES` / `isReadOnlyPath()`），可直接对齐。

---

## 已有代码说明

### `extensions/bid-review/contract.ts`

定义了 BidReviewService 接口：

- `BidDocument` — 已加载的文档信息
- `BidIssue` — 一条审查问题（severity: critical/warning/info, category, title, description, location, suggestion）
- `BidReviewState` — 审查状态（loadedFiles, reviewStatus, issues, summary, progress）
- `BidReviewService` — 服务接口（loadDocument, startReview, cancelReview, exportReport）

### `extensions/bid-review/index.ts` 和 `desktop.ts`

**不是空壳**（上一版这里写错了）。已有可跑的 mock 全链路：

- `index.ts` 注册了 `bid_load_document` / `bid_start_review` / `bid_export_report` 三个工具、`bid-review` 命令，
  并通过 `registerDesktopView` + `defineFacet` 把面板接到 `BidReviewService`
- `desktop.ts` 是 375 行的面板 UI（筛选、进度、统计、结论列表）
- `mock-review.ts` 提供假数据（`generateMockIssues` / `generateMockSummary`）

要换成真实实现，**替换点是 `runMockReview` 和 `mock-review.ts`**，UI 和接口契约基本可以保留。

---

## 参考文档

如果需要了解更深的设计细节，原始文档在上游仓库 `gen-document` 的 `design-docs/` 下：

- `design-docs/restructuring-plan.md` — 架构决策文档（为什么这样分层、Tool Effect 分类、pi-agent SDK 选型、工作空间模型）
- `design-docs/implementation-prd.md` — 实现规格文档（Tool Set 定义规范、工作空间目录结构、manifest.json schema、会话模型、端到端示例）
- `skills/genoffice/SKILL.md` — genoffice CLI 完整命令参考（包括批注 API 的详细用法）

这些文档通过 symlink 可以在 `vendor/genoffice/` 上游目录直接读到，不需要复制过来。
实际路径：`/Users/david/orca/workspaces/gen-document/feat-workspace/design-docs/`、`.../skills/genoffice/SKILL.md`。

上表中 `design-docs/` 与 `skills/` 位于**上游仓库根目录**，不在 `vendor/genoffice/` 内——`vendor/genoffice/` 只挂了 `packages/` 下的 6 个包。

### 新增参考（本次修订发现）

- 上游 `packages/workspace-harness/` — 工作空间模型、四区、只读约束、`review_write_findings`、批注工具的现成实现，**建议在动手前通读**
- 上游 `apps/workspace-shell/` — 已建成的「工作空间 + 文件树 + 会话 + agent 对话」桌面壳，第 5 步的重要参照
- 上游 `packages/cli/src/commands/docs.ts` — `docs read/apply/check` 的完整参数与 `--comments` / `--ops` 用法

---

## 修订记录

**2026-10-05（第一轮：对照源码更正）**：

1. **修正「关键 genoffice API」一节**。原文把这些 API 归于 docx-engine / file-parse，实际：
   - `doc_add_comment` 等 6 个来自 `workspace-harness`
   - `doc_reply_comment` / `doc_resolve_comment` / `doc_delete_comment` / `doc_get_context` **在整棵上游仓库中不存在**
   - 补上引擎真实 API：`parseDocx` / `saveDocx` + `CommentInfo[]` 全量重写语义 + run 级 `commentIds` 锚定
2. **新增「漏掉的一层：workspace-harness」**。原文档完全未提这个包，而它是第 1–4 步的上游实现。
3. **重写「当前状态」**。原表把本地已完成的 mock 实现与样例工作空间误记为「未做」；补上「全项目零 @genoffice 引用」这一关键事实。
4. **新增第 0 步**：拍板「复用 workspace-harness 还是自建」，置于第 1 步之前。
5. **修正分支名**：`feat-workspace` → `main`。
6. **修正工作空间目录结构**为上游四区模型（`引用/资料/产出/意见`），原 `references/` 版本与上游不符。
7. **标注未提交风险**：`extensions/bid-review/*`、`workspaces/` 等未提交且未跟踪。
8. 补记 `pptx-engine`（vendor 里有、原表漏了）；修正「参考文档」的实际路径。

**2026-10-05（第二轮：引入与实测）**：

9. **引入 `workspace-harness`**：连同 `agent-core` / `ai-provider` / `xlsx-gateway` 一起 symlink 进 `vendor/genoffice/`，`scripts/link-genoffice.mjs` 包清单已更新，扩展已声明依赖。
10. **解决 SDK 冲突**：上游 `exports` 加子路径映射（`./workspace/*`、`./tools/*`、`./tool/*`），绕开锁在 0.87.1 的 agent 层。
    实测从本项目 import 成功（打包 242.9kB，对比拖入 agent 层的 2.2mB）：manifest 往返、四区只读规则、`tools/review` 导出均正常。
    **该改动尚未在上游仓库提交。**
11. **实测证明无头写批注可行**：`GeneratedBlock.runs[].commentIds` + `SaveOptions.comments` → `saveDocx` → 重新 `parseDocx` 能读回批注与锚点，不需要 Tiptap 编辑器。
12. **第 0 步改为通道已打通**；第 1 步样例标书改为**以真实投标材料为基底**（同级 `bid-workshop/资料/`）。

**2026-10-06（第三轮：第 1 步落地）**：

13. **第 1 步部分完成**：产出样例标书 `workspaces/bid-sample/投标文件-某软件科技.docx`（5 章、17 标题、3 张表、6 个埋点）
    与 `评审条件.md`；生成器 `extensions/bid-review/scripts/build-sample-bid.ts` 已装成可重跑脚本（`build:sample-bid`）。
14. **发现并处理公开仓库风险**：`smart-kind/bid-workshop` 是 **public**（`gh repo view` 核实 `isPrivate: false`）。
    真实材料含客户名与合同金额（197 万 / 131 万 / 54 万等），产物与生成器**已全部脱敏**为虚构值；
    真实数据只留在同级 `bid-workshop/资料/`，不进本仓库。此项已写进「当前状态」作为长期约束。

**2026-10-06（第四轮：第 2 步落地 + CI 真相）**：

15. **第 2 步完成**：新增 `document.ts`（解析器端口 + 结构化总结）与 `parser-docx.mjs`（唯一碰引擎的适配器），
    `bid_load_document` 现在真正解析 .docx 并把大纲+正文交给模型。实测对样例文档 `RESULT: PASS`。
16. **修好 `check:workspaces`**：`extensions/bid-review` 从首次提交起就缺 `typecheck` 脚本，是 CI 红的直接原因之一；
    已按 `examples/desktop-extensions/*` 的约定补 tsconfig 与脚本。
17. **查清 CI 从未通过**：`gh run list` 显示首次推送即 `failure`。除 `check:workspaces` 外，
    `format:check` 另有 16 个**既有**违规文件（未擅自重排，见「CI 现状」）。
18. **解耦 vendor 依赖**：按「扩展不直接依赖引擎」的方向重构——端口 + `.mjs` 适配器 + `.d.mts` 声明，
    使 CI 无 vendor 时也能 typecheck（已实测通过）。代价与剩余工作见「CI 现状」。

**2026-10-06（第五轮：第 3 步落地）**：

19. **第 3 步完成**：审查由模型执行，扩展组装 brief 并接收结论。
    新增 `bid_record_findings`，`bid_start_review` 改为返回 review brief；
    面板「开始审查」通过 `pi.sendUserMessage()` 真正触发 agent turn。删除 `mock-review.ts` 与假进度定时器。
20. `BidIssue.location` 增加 `blockIndex` / `quote`，新增 `basis` —— 为第 4 步锚定批注铺路。
    实测 brief 组装与结论映射均 `RESULT: PASS`；CI 模拟（无 vendor）typecheck 仍通过。

**2026-10-06（第六轮：第 4 步 + 面板终于跑起来）**：

21. **第 4 步完成**：`bid_write_comments` 把结论写成原生 Word 批注，只重建需要批注的块、其余逐字节保留；
    往返实测 4 条批注锚点精确、文档结构与表格完全未变。踩到两个坑（两处 id 必须一致、`w:id` 必须是整数）已记录。
22. **Electron 验证失败并挖出三处既有缺陷**——面板**此前从未渲染成功过**。已全部修复，详见「面板为何此前从未渲染」。
23. **core lane 回归测试**：`apps/desktop/tests/core/bid-review.spec.ts` 在真实 Electron 上加载真实 .docx，
    断言 `74 个块` / `3 张表` 与五个真实章节标题。**已通过**（`1 passed`）。

**2026-10-06（第七轮：第 5 步）**：

24. **新增文档面**（第二个扩展视图 `bid-document`，`document-desktop.ts`）：渲染解析出的正文逐块内容，
    并把每条结论按 `blockIndex` 显示为段旁批注卡，随 state 实时出现。
    与 `bid-review` 共用 `backendFacet()` 工厂与同一个 `BidReview` 服务。
25. **服务补齐闭环**：`readDocument`（正文交给视图）、`writeComments`（UI 直接写批注）；
    审查面板加「写入批注」按钮并显示结果。
26. **Electron 测试扩展到两个视图**：一条测试串起「面板解析 → 文档视图渲染正文」。**已通过**（`1 passed`）。
27. **明确未做并给出依据**：「把 genoffice 编辑器作为部件接上」= 跨 Electron 大版本（37 vs 43）的
    应用移植，且扩展 iframe 的 CSP 装不下它（`connect-src 'none'` 等）。详见第 5 步一节。

**2026-10-06（第八轮：第 1 条 项目自足性）**：

28. **genoffice 源码入库**（10 个包 + `tools/ooxml-validate` + `tsconfig.base.json` + 许可证），
    `vendor/` 不再被 gitignore。上游是链接工作树且有 41 项未提交，**子模块会拿到编译不过的旧快照**，故选择直接 vendor。
29. **`pnpm install --frozen-lockfile` 通过**（17 个 workspace、lockfile 含 10 个 vendor importer）——
    此前 vendor 存在时必然失败，是全新 clone 与 CI 的安装路径。
30. **`pnpm typecheck` 全绿**（16 个 workspace，含全部 vendored 包与 apps/desktop）。
31. 同时修掉：`.npmrc` 加 `link-workspace-packages=true`（vendored 包内部 `"*"` 依赖需链接本地副本）、
    `.gitignore` 加 `!vendor/**/*.js`（`*.js` 规则会吃掉 vendored 的 JS）、
    `.prettierignore` 加 `/vendor/`（588 个上游格式文件不该被本仓库重排）。
32. `scripts/link-genoffice.mjs` → `scripts/sync-genoffice.mjs`（从上游复制更新，结果是可评审的文件改动）。

**2026-10-06（第九轮：CI 转绿）**：

33. **修掉 CI 的其余红灯**：`format:check`（17 个既有未格式化文件）、`lint`
    （`extensions/tsconfig.lint.json` **从未创建过**，扩展的 typed lint 一直在报解析错误；vendored 源码需排除）。
34. **扩展前端 bundle 签入**（与 `examples/desktop-extensions/*/dist/` 同一约定）：
    此前**没有任何流水线构建过它**，`.gitignore` 还把它排除，所以面板前端产物在任何 clone/CI 上都不存在。
    `build.mjs` 改为 examples 的风格（absWorkingDir / outfile / minify / `--check`），只构建两个被引用的前端入口
    （`dist/index.js` 无人引用，已停建），并挂上 `build:check` 与 `test` 守卫陈旧。
35. **面板在真实 Electron 上通过**（压缩后的 bundle，`1 passed`）。
