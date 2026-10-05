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

| 能力 | 来源 | 位置 | 状态 |
|---|---|---|---|
| Electron 桌面壳 + AI Agent | pi-gui fork | `apps/desktop/` | ✅ 已引入 |
| Word 文档解析 | genoffice `file-parse` | `vendor/genoffice/file-parse` (symlink) | ✅ 已引入（仅纯文本提取） |
| Word 渲染/编辑/批注 | genoffice `docx-engine` | `vendor/genoffice/docx-engine` (symlink) | ✅ 已引入（**但项目代码零引用**） |
| HTML→DOCX 转换 | genoffice `html2docx` | `vendor/genoffice/html2docx` (symlink) | ✅ 已引入 |
| 字体度量 | genoffice `font-metrics` | `vendor/genoffice/font-metrics` (symlink) | ✅ 已引入 |
| 国际化 | genoffice `i18n` | `vendor/genoffice/i18n` (symlink) | ✅ 已引入 |
| 幻灯片引擎 | genoffice `pptx-engine` | `vendor/genoffice/pptx-engine` (symlink) | ✅ 已引入（上一版本文档漏记） |
| **工作空间模型 + 文档/批注工具 + 审查工具** | **genoffice `workspace-harness`** | **未引入** | **❌ 见下节** |
| 无头文档 CLI（调试用） | genoffice `cli` | 未引入（上游 `packages/cli`，bin `genoffice`） | ❌ 未引入 |
| 标书审查业务逻辑 | 本项目 | `extensions/bid-review/` | ⚠️ 仅有 mock |

vendor 下的包都是 symlink，指向上游 `/Users/david/orca/workspaces/gen-document/feat-workspace/packages/` 下的对应目录。链接已核实全部有效。

---

## 漏掉的一层：workspace-harness

上一版本文档完全没有提到这个包，而它**正是本文档第 1–4 步的上游实现**。

`@genoffice/workspace-harness`（上游 `packages/workspace-harness`）自述：
> "Goal-driven document workspace harness: tool registry with effect dispatch, workspace + read-only reference storage, pi-agent host (**no Electron dependency**)"

已核实其 `package.json` 依赖仅为 `pi-agent-core`、`pi-ai`、`agent-core`、`ai-provider`、`docx-engine`、`pptx-engine`、`xlsx-gateway`、`typebox`——**源码中零 `electron` 引用**，可在无头 / 非 Electron 环境直接使用。

它包含的东西，和本文档的对应关系：

| workspace-harness 里的实现 | 对应本文档 |
|---|---|
| `workspace/manifest.ts` — manifest.json 读写（schemaVersion/goal/references/documents/vcs/demo） | §核心概念「工作空间」提出的 manifest.json |
| `workspace/zones.ts` — 四区模型，`READ_ONLY_ZONES` + `isReadOnlyPath()` 在工具层强制只读 | §设计哲學「只读引用资料是硬约束」 |
| `workspace/references.ts` — `ReferenceStore`，把外部目录挂载进工作空间 | §核心概念 `references/` |
| `workspace/documents.ts`、`store.ts`、`git.ts`、`conversations.ts` | 文档注册、版本、会话 |
| `tools/document.ts`、`document-edit.ts` | 第 2、4 步的文档读写与批注 |
| `tools/review.ts` — `review_write_findings` | **第 3 步的审查结论模型** |
| `tools/ui.ts` — `ui_open_document` 等 | 第 5 步的编辑器联动 |
| `workspace/demo.ts` — `ensureDemoWorkspace()` / `provisionDemoWorkspace()` | **第 1 步的样例工作空间（已有可抄的实现）** |
| `agent/host.ts` — pi-agent host，无 Electron | 第 3 步的 Agent 运行时 |

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

| 上一版写的 | 实际情况 |
|---|---|
| `doc_reply_comment` | 不存在。能力只以 CLI 操作名 `reply_comment` 存在 |
| `doc_resolve_comment` | 不存在。同上，CLI 操作名 `resolve_comment` |
| `doc_delete_comment` | 不存在。同上，CLI 操作名 `delete_comment` |
| `doc_get_context` | 不存在，任何地方都没有 |

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

| 路线 | 做法 | 优点 | 代价 |
|---|---|---|---|
| A. 直接调引擎 | 引入 `docx-engine`，用 `parseDocx` / `saveDocx` | 无头、依赖最少、**已实测跑通**（见下） | 批注需自己把段落转成 generated 块并忠实带上格式 |
| B. 复用 workspace-harness | 把 `workspace-harness` symlink 进 vendor | 工作空间/四区/只读约束/审查结论模型现成 | **当前 import 不进去**（SDK 版本冲突，见下）；`doc_*` 是活编辑器工具 |
| C. 子进程调 CLI | 起 `genoffice docs apply --ops` | 零集成、调试期最省事 | 依赖上游绝对路径、不在 PATH、每次 fork 进程 |

### 2026-10-05 实测结果

**已完成的引入**：`workspace-harness` 及其依赖（`agent-core`、`ai-provider`、`xlsx-gateway`）已按既有方式 symlink 进 `vendor/genoffice/`（`scripts/link-genoffice.mjs` 的包清单已更新），pnpm 认作 workspace 项目，`extensions/bid-review` 已声明 `@genoffice/docx-engine` 与 `@genoffice/workspace-harness` 为依赖。

**⚠️ 阻塞 1：SDK 版本冲突，`workspace-harness` 目前 import 不进来**

- `workspace-harness` 锁 `@earendil-works/pi-agent-core@0.87.1` 与 `@earendil-works/pi-ai@0.87.1`
- 本项目（pi-gui fork）用的是 **1.0.0**
- 实测 `import '@genoffice/workspace-harness'` 失败：`does not provide an export named 'estimateContextTokens'`

耦合范围是**有界的**——只有 `src/agent/` 下 5 个文件 import `@earendil-works`（`adapt.ts` / `convert.ts` / `effect-dispatch.ts` / `host.ts` / `stream-fn.ts`）。`src/workspace/*` 和 `src/tools/*`（含 `review_write_findings`、`doc_add_comment`）**都不依赖**它。

但 `package.json` 的 `exports` 只映射了 `"."`，所以子路径 import 被 `ERR_PACKAGE_PATH_NOT_EXPORTED` 阻止。想只用工作空间/工具层、不用它的 agent host，需要选一条路：改上游 exports 映射 / 用 bundler alias 绕 / 把需要的模块复制进来 / 或者把它的 agent 层适配到 SDK 1.0.0（真实工作量）。

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

| 项目 | 状态 |
|---|---|
| pi-gui 壳 fork 到 bid-workshop | ✅ 已完成 |
| 品牌改名 + 移除无关模块 | ✅ 已完成 |
| genoffice 包引入（symlink） | ✅ 已完成，链接全部有效 |
| GitHub 仓库 (smart-kind/bid-workshop) | ✅ 已创建并推送，分支 `main` |
| bid-review 扩展 | ⚠️ **不是"空壳"**：已有完整 mock 实现（见下） |
| 样例工作空间 | ⚠️ **部分完成**：`workspaces/bid-sample`、`workspaces/rangli-review` 已存在，但样例是 **JSON 不是 .docx** |
| **文档加载链路**（docx → 结构化数据） | ❌ 未做。全项目**零 `@genoffice` 引用**，一行都没接上 genoffice |
| AI 审查逻辑 | ❌ 未做，目前是定时器 + 写死的样例数据 |
| Word 批注输出 | ❌ 未做 |
| UI 集成 | ⚠️ 面板 UI 已有（接的是 mock service）；右侧文档区未接 |

**bid-review 已有的实际代码**（均为本地未提交/未跟踪）：

| 文件 | 规模 | 内容 |
|---|---|---|
| `extensions/bid-review/contract.ts` | 47 行 | `BidReviewService` 接口定义 |
| `extensions/bid-review/index.ts` | 195 行 | 3 个工具（`bid_load_document` / `bid_start_review` / `bid_export_report`）+ 命令 + desktop view 注册 + facet service |
| `extensions/bid-review/desktop.ts` | 375 行 | 完整面板 UI：严重度/类目筛选、进度条、统计卡、结论列表 |
| `extensions/bid-review/mock-review.ts` | 105 行 | 写实的中文审查结论样例（市政道路改造工程，5+ 条，含 critical/warning/info） |

⚠️ **风险**：以上文件以及 `workspaces/`、`start-dev*.sh` 全部**未提交且未跟踪**，一次 `git clean -fd` 即全部丢失，也没有备份在远端。

---

## 下一步工作（按顺序）

### 第 0 步：复用 workspace-harness（已拍板，但有前置阻塞）

**已拍板：复用 `workspace-harness`**，不再自建工作空间模型与审查结论模型。

**已完成**：包已 symlink 进 vendor、pnpm 已认作 workspace 项目、扩展已声明依赖。

**待解决（不解决则第 2/3 步无法复用其工具层）**：

1. **SDK 版本冲突**——`workspace-harness` 的 agent 层锁 pi-agent-core/pi-ai `0.87.1`，本项目是 `1.0.0`，包入口 import 直接失败。
   它的 `workspace/*` 与 `tools/*` 不依赖该 SDK，但 `exports` 只映射 `"."`，子路径进不去。
   需要选一条：改上游 exports 映射 / bundler alias 绕 / 复制所需模块 / 把其 agent 层适配到 1.0.0。
2. **工作空间目录结构**——是否采用上游四区模型（`引用/资料/产出/意见`）与 `.workspace/manifest.json`。
3. **`doc_*` 工具是活编辑器工具**——`doc_add_comment` 走 `docEditBridge`，需要第 5 步的编辑器联动到位才能用；
   无头路径见「2026-10-05 实测结果」（已跑通，但需自己处理段落转换）。

现有未提交工作已提交为基线（`36d94cf`）。

### 第 1 步：建立样例工作空间

在 bid-workshop 里初始化一个样例工作空间，包含：

1. **一份样例标书** .docx — 用 genoffice 的 docx-engine 生成一份假的投标书，包含典型章节：
   - 封面（项目名称、投标方、日期）
   - 目录
   - 公司简介与资质
   - 技术方案（含若干段落和表格）
   - 报价表
   - 服务承诺
   - 故意埋入几个典型问题（缺少签章、报价计算错误、技术方案缺少关键章节等）

   > 实现提示：用 `buildBlankDocx(...)` 造空白文档 + `saveDocx` 落盘。
   > 现成范式可抄上游 `workspace-harness/src/workspace/demo.ts` 的 `provisionDemoWorkspace()`——它就是这么造演示用 .docx 的。
   > 现有 `workspaces/bid-sample/sample-bid.json` 的内容可以直接搬成 .docx 的章节。

2. **一份评审条件** — Markdown 或 JSON，列出审查维度和标准：
   ```markdown
   # 标书评审条件
   ## 资质审查
   - 必须包含有效的营业执照信息
   - 必须具备相关行业资质证明
   
   ## 技术方案
   - 必须包含完整的实施方案
   - 必须有项目管理计划
   - 必须有质量保证措施
   
   ## 商务审查
   - 报价必须包含明细
   - 总价必须与明细合计一致
   - 必须有有效期承诺
   
   ## 格式审查
   - 必须有目录
   - 必须有页码
   - 关键页面必须有签章
   ```

3. **期望输出** — 一份带批注的 .docx（或运行时动态生成），展示审查效果

4. **manifest.json** — 工作空间元数据

### 第 2 步：文档加载链路

- bid-review 扩展接收 .docx 文件
- 调用 `parseDocx(bytes)` 解析（**不是** `doc_read_blocks`）
- 提取结构化内容（block 列表、章节结构、表格数据）
- 把内容交给 AI Agent

### 第 3 步：AI 审查逻辑

- AI Agent 拿到文档结构 + 评审条件
- 逐项分析，生成审查结论
- 每条结论包含：位置（blockIndex 或 textSpan）、问题描述、严重度、建议
- 结论结构建议直接对齐 `review_write_findings` 的 schema（`id` / `check` / `basis` / `location` / `quote` / `finding` / `advice`），避免自造一套

### 第 4 步：Word 批注输出

- 审查结论 → 构造 `CommentInfo[]` → `saveDocx(parsed, blocks, { comments })`
- 批注锚定到 run（`commentIds`），要求 commentRangeStart..End 在同一段落内
- 保存后 .docx 带批注状态
- 在编辑器中实时看到批注

### 第 5 步：UI 集成

- 左侧：AI 对话（pi-gui 已有）
- 右侧：Word 文档预览和编辑（genoffice 部件）
- 用户看到 AI 审查过程 + 文档上实时出现的批注

依赖关系：第 0 步先行且独立；第 1 步独立；第 2→3→4 步串行；第 5 步在 2-4 通了之后做。

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
10. **记录阻塞**：`workspace-harness` 的 agent 层锁 pi-agent-core/pi-ai `0.87.1`，本项目 `1.0.0`，包入口 import 失败；耦合仅限 `src/agent/` 5 个文件，但 `exports` 只映射 `"."`，子路径不可用。
11. **实测证明无头写批注可行**：`GeneratedBlock.runs[].commentIds` + `SaveOptions.comments` → `saveDocx` → 重新 `parseDocx` 能读回批注与锚点，不需要 Tiptap 编辑器。
12. **第 0 步改为已拍板**（复用 workspace-harness）并列出三项待解决前置。


