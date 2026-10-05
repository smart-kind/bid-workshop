# Bid Workshop — 交接文档

> 本文档自包含。读完即可接手，不需要再翻原始 genoffice 仓库的设计文档。
> 如需更深细节，原始设计文档在 `vendor/genoffice/` 对应的上游仓库 `gen-document` 的 `design-docs/` 下。

---

## 这是什么

Bid Workshop 是一个**标书审查桌面应用**。用户导入标书（Word .docx），AI 自动审查，审查结果直接以 **Word 批注**的形式写回文档——用户打开 Word 就能看到带批注的标书。

技术路线：用 pi-gui（Electron AI 壳）做外壳，把 genoffice 的 docx-engine 当文档部件嵌入，AI 通过 genoffice 的 API 控制 Word 文档。

GitHub: `smart-kind/bid-workshop`，当前分支 `feat-workspace`。

---

## 架构决策

**为什么 fork pi-gui 而不是用 genoffice 主体？**
genoffice 是一个文档编辑器，AI 能力是后来加的补丁。标书审查需要一个以 AI Agent 对话为核心的壳，Word 编辑只是其中一个部件。pi-gui 正好是这种壳——Electron + pi-agent SDK + 工具调用 + 会话管理。

**为什么 genoffice 是"部件"而不是"主体"？**
genoffice 的价值在于它的 docx-engine：能解析 .docx、能渲染、能通过 API 插入批注。这些能力被当作组件引入 bid-workshop，而不是让 bid-workshop 变成 genoffice 的一个插件。

**组件来源：**

| 能力 | 来源 | 位置 |
|---|---|---|
| Electron 桌面壳 + AI Agent | pi-gui fork | `apps/desktop/` |
| Word 文档解析 | genoffice `file-parse` | `vendor/genoffice/file-parse` (symlink) |
| Word 渲染/编辑/批注 | genoffice `docx-engine` | `vendor/genoffice/docx-engine` (symlink) |
| HTML→DOCX 转换 | genoffice `html2docx` | `vendor/genoffice/html2docx` (symlink) |
| 字体度量 | genoffice `font-metrics` | `vendor/genoffice/font-metrics` (symlink) |
| 国际化 | genoffice `i18n` | `vendor/genoffice/i18n` (symlink) |
| 标书审查业务逻辑 | 本项目 | `extensions/bid-review/` |

vendor 下的包都是 symlink，指向上游 `/Users/david/orca/workspaces/gen-document/feat-workspace/packages/` 下的对应目录。

---

## 核心概念

### 工作空间（Workspace）

一个工作空间 = 磁盘上一个文件夹 = 一个 git 仓库。包含：

```
<workspace>/
├── .workspace/
│   └── manifest.json          # 工作空间元数据
├── references/                # 只读引用资料（软链接，不复制）
├── 标书.docx                  # 被审查的文档
├── 评审条件.md                # 审查标准
└── .workspace/sessions/       # AI 对话历史
```

### 批注是输出

AI 审查的结果不是生成一份新报告，而是直接在 Word 文档里加批注。批注锚定到具体段落或文字 span，用户打开 Word 就能看到问题在哪里。

---

## 关键 genoffice API

这些是标书审查流程需要用到的 API，全部来自 genoffice 的 docx-engine 和 file-parse 包。

### 文档解析
- `file-parse` 包：读取 .docx 文件，提取结构化内容（段落、章节、表格）

### 批注 API（这是核心输出通道）
- `doc_read_comments` — 读取文档中已有的批注线程
- `doc_add_comment` — 在指定位置插入批注（锚定到 block 或 text span）
- `doc_reply_comment` — 回复某条批注
- `doc_resolve_comment` — 标记批注为已解决
- `doc_delete_comment` — 删除批注

批注 id 来自 `doc_read_comments` 的返回值。`doc_add_comment` 的锚定方式：
- 锚定到 block（段落级）：指定 blockIndex
- 锚定到 text span（文字级）：指定文本范围

### 文档读写
- `doc_read_blocks` — 分页读取文档内容（返回 block 列表，每个 block 有 index、type、内容）
- `doc_get_context` — 获取文档整体结构（大纲、统计）
- `doc_insert_content` — 在指定位置插入内容
- `doc_replace_blocks` — 替换指定范围的块
- `doc_apply_ops` — 批量结构化操作（事务）

### CLI 命令（调试/脚本用）
- `genoffice docs read <file>` — 读取文档结构
- `genoffice docs read <file> --comments` — 读取批注
- `genoffice docs apply <file> --ops <json>` — 批量操作
- `genoffice docs check <file>` — 校验文档

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

审查维度（可定制，初始样例覆盖这些）：
- 资质要求是否满足
- 报价是否合理
- 技术方案是否完整
- 法律条款是否有风险
- 格式是否合规（页码、目录、签章位置等）

---

## 当前状态

| 项目 | 状态 |
|---|---|
| pi-gui 壳 fork 到 bid-workshop | ✅ 已完成 |
| 品牌改名 + 移除无关模块 | ✅ 已完成 |
| genoffice 包引入（symlink） | ✅ 已完成 |
| GitHub 仓库 (smart-kind/bid-workshop) | ✅ 已创建并推送 |
| bid-review 扩展骨架代码 | ✅ 骨架已有（contract.ts 定义了接口，无业务逻辑） |
| **样例工作空间** | ❌ 未做 |
| **文档加载链路**（docx → 结构化数据） | ❌ 未做 |
| **AI 审查逻辑** | ❌ 未做 |
| **Word 批注输出**（AI → genoffice API → 批注） | ❌ 未做 |
| **UI 集成**（壳 + 文档部件联动） | ❌ 未做 |

---

## 下一步工作（按顺序）

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
- 调用 genoffice file-parse / docx-engine 解析
- 提取结构化内容（段落列表、章节结构、表格数据）
- 把内容交给 AI Agent

### 第 3 步：AI 审查逻辑

- AI Agent 拿到文档结构 + 评审条件
- 逐项分析，生成审查结论
- 每条结论包含：位置（blockIndex 或 textSpan）、问题描述、严重度、建议

### 第 4 步：Word 批注输出

- 审查结论 → genoffice `doc_add_comment` API 调用
- 在对应位置插入批注
- 保存后 .docx 带批注状态
- 在编辑器中实时看到批注

### 第 5 步：UI 集成

- 左侧：AI 对话（pi-gui 已有）
- 右侧：Word 文档预览和编辑（genoffice 部件）
- 用户看到 AI 审查过程 + 文档上实时出现的批注

依赖关系：第 1 步独立；第 2→3→4 步串行；第 5 步在 2-4 通了之后做。

---

## 设计哲学（防止走偏）

1. **灵活性优先**：不做僵化的模板系统。审查条件可定制，审查维度可扩展，输出格式灵活。
2. **批注是核心输出**：不是生成新报告，而是在原文档上标注问题。这是产品差异点。
3. **不做模板系统**：这是 genoffice 上游的刻意决策——参考 7 页做成 13 页是允许的，格式本来就不该固定。
4. **只读引用资料是硬约束**：`references/` 目录下的文件通过软链接引入，对工作空间只读，工具层必须拒绝写入。

---

## 已有代码说明

### `extensions/bid-review/contract.ts`
定义了 BidReviewService 接口：
- `BidDocument` — 已加载的文档信息
- `BidIssue` — 一条审查问题（severity: critical/warning/info, category, title, description, location, suggestion）
- `BidReviewState` — 审查状态（loadedFiles, reviewStatus, issues, summary, progress）
- `BidReviewService` — 服务接口（loadDocument, startReview, cancelReview, exportReport）

### `extensions/bid-review/index.ts` 和 `desktop.ts`
扩展注册入口，目前是空壳，需要填充业务逻辑。

---

## 参考文档

如果需要了解更深的设计细节，原始文档在上游仓库 `gen-document` 的 `design-docs/` 下：

- `design-docs/restructuring-plan.md` — 架构决策文档（为什么这样分层、Tool Effect 分类、pi-agent SDK 选型、工作空间模型）
- `design-docs/implementation-prd.md` — 实现规格文档（Tool Set 定义规范、工作空间目录结构、manifest.json schema、会话模型、端到端示例）
- `skills/genoffice/SKILL.md` — genoffice CLI 完整命令参考（包括批注 API 的详细用法）

这些文档通过 symlink 可以在 `vendor/genoffice/` 上游目录直接读到，不需要复制过来。
