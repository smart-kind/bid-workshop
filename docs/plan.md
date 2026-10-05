# Bid Workshop 计划书

## 一、项目目标

构建一个**标书审查桌面应用**。用户导入标书（Word），AI 自动审查，审查结果直接以 **Word 批注** 的形式写回文档。

## 二、架构

```
bid-workshop/
├── 壳：pi-gui（Electron 桌面应用，提供 AI Agent 对话、工具调用、会话管理）
├── 文档部件：genoffice docx-engine（作为组件嵌入，通过 API 被 AI 控制）
└── 业务扩展：extensions/bid-review/（标书审查逻辑）
```

核心思路：
- pi-gui 是**壳**，提供 AI Agent 能力
- genoffice 是**部件**，提供 Word 文档读写能力（特别是批注 API）
- AI 通过 genoffice 的 API 控制 Word 文档：读取内容 → 分析 → 写回批注

## 三、端到端流程

```
用户导入标书.docx
       ↓
genoffice 解析文档 → 提取文本和结构（段落、表格、章节）
       ↓
AI Agent 拿到文档结构 → 按审查维度逐项分析
       ↓
AI 生成审查结论 → 调用 genoffice 批注 API
       ↓
Word 文档变为带批注状态 → 用户在编辑器中看到批注
```

审查维度（示例，后续可定制）：
- 资质要求是否满足
- 报价是否合理
- 技术方案是否完整
- 法律条款是否有风险
- 格式是否合规

## 四、需要做的事（按顺序）

### 第 1 步：样例工作空间

在 bid-workshop 里建立一个样例工作空间，自动初始化时放入：
- 一份样例标书文档（用 genoffice 生成一份假的投标书 .docx，包含典型章节：公司简介、技术方案、报价表、资质证明等）
- 一份样例评审条件（JSON 或 Markdown，列出要审查的维度和标准）
- 目的：让任何人 clone 项目后，打开 app 就能直接看到效果

### 第 2 步：文档加载链路

- bid-review 扩展接收一份 .docx 文件
- 调用 genoffice 的 file-parse / docx-engine 解析文档
- 提取出结构化的文档内容（段落列表、章节结构、表格数据）
- 把内容交给 AI Agent

### 第 3 步：AI 审查链路

- AI Agent 拿到文档结构 + 评审条件
- 逐项分析，生成审查结论
- 每条结论包含：位置（哪个段落/哪句话）、问题描述、建议

### 第 4 步：Word 批注输出

- AI 的审查结论转化为 genoffice 的批注 API 调用
- 调用 docx-engine 的批注接口，在对应位置插入批注
- 保存后的 .docx 文件打开就是带批注的状态
- 在 bid-workshop 的编辑器里直接看到批注效果

### 第 5 步：UI 集成

- 在 pi-gui 桌面界面里：
  - 左侧：AI 对话（pi-gui 已有）
  - 右侧/下方：Word 文档预览和编辑（genoffice 部件）
  - 用户可以看到 AI 审查过程的对话 + 文档上实时出现的批注

## 五、当前状态

| 项目 | 状态 |
|---|---|
| pi-gui 壳 fork 到 bid-workshop | ✅ 已完成 |
| genoffice 包引入（symlink） | ✅ 已完成 |
| GitHub 仓库创建 | ✅ 已完成 (smart-kind/bid-workshop) |
| bid-review 扩展骨架代码 | ✅ 骨架已有，无业务逻辑 |
| 样例工作空间 + 样例标书 | ❌ 未做 |
| 文档加载链路（docx → 结构化数据） | ❌ 未做 |
| AI 审查逻辑 | ❌ 未做 |
| Word 批注输出（AI → genoffice API → 批注） | ❌ 未做 |
| UI 集成（壳 + 文档部件联动） | ❌ 未做 |

## 六、依赖关系

```
第1步（样例工作空间）
  ↓
第2步（文档加载）→ 第3步（AI审查）→ 第4步（批注输出）
                                              ↓
                                        第5步（UI集成）
```

第1步可以独立做。第2→3→4步是串行依赖。第5步在2-4基本通了之后做。

## 七、关键组件来源

| 组件 | 来源 | 说明 |
|---|---|---|
| Electron 桌面壳 | pi-gui fork | Agent 对话、工具调用、会话管理 |
| 文档解析 | genoffice file-parse | 读取 .docx |
| 文档渲染/编辑 | genoffice docx-engine | Word 渲染、批注 API |
| AI 能力 | pi-gui 内置 | 多模型支持、工具调用 |
| 批注写入 | genoffice docx-engine | 通过 API 插入批注到指定位置 |
