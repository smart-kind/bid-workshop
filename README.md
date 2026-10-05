# Bid Workshop

AI 驱动的标书审查桌面应用。基于 [pi-gui](https://github.com/earendil-works/pi-gui) Electron 壳 + [genoffice](../gen-document/feat-workspace/) 文档引擎构建。

## 项目定位

Bid Workshop 将 pi-gui 的 AI Agent 桌面能力与 genoffice 的文档处理引擎结合，专注于：

- **标书加载**：加载 .docx 格式的招标文件，自动解析章节结构
- **AI 审查**：利用 AI Agent 对标书进行多维度审查（资质、报价、技术方案、法律条款、格式合规）
- **问题报告**：生成结构化的审查报告，支持导出 Markdown/PDF

## 架构概览

```
bid-workshop/
├── apps/desktop/          # Electron 桌面应用（fork 自 pi-gui）
├── packages/              # 核心框架包（fork 自 pi-gui）
│   ├── catalogs/          # 模型/技能/提示词目录
│   ├── extension-ui/      # 扩展 UI 框架
│   ├── pi-sdk-driver/     # Pi SDK 驱动层
│   └── session-driver/    # 会话管理驱动
├── extensions/            # 桌面扩展
│   └── bid-review/        # 标书审查扩展（核心业务逻辑）
├── vendor/genoffice/      # 引入的 genoffice 文档引擎包
│   ├── docx-engine        # Word 文档渲染引擎
│   ├── file-parse         # 文档解析
│   ├── html2docx          # HTML 转 Word
│   ├── font-metrics       # 字体度量
│   ├── i18n               # 国际化
│   └── pptx-engine        # PPT 引擎（docx-engine 依赖）
├── examples/              # 扩展开发示例
│   └── desktop-extensions/
│       └── pr-review/     # PR 审查扩展（参考实现）
└── skills/                # 自定义 Pi 技能
```

## 技术选型决策

### 为什么 fork pi-gui 而非从零搭建

| 考虑方案                | 优点                                               | 缺点                                                            |
| ----------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| 从零搭建 Electron 应用  | 完全控制                                           | 开发周期长，需重复实现 Agent 会话、工具调用、桌面 UI 等基础设施 |
| 使用 pi-gui 作为壳      | 开箱即用的 Agent 框架、扩展系统、会话管理、桌面 UI | 需理解 pi-gui 架构并适配                                        |
| 使用其他 Agent 桌面应用 | 可能有更轻量的选择                                 | 生态不成熟，缺少生产级 Electron 桌面 Agent 框架                 |

**选择 pi-gui**：它是目前最成熟的生产级桌面 Agent 框架，拥有完整的扩展系统（Chord 服务定义 + Pi 工具注册 + 桌面视图注册）、会话管理、多模型支持。

### 为什么引入 genoffice 作为文档部件

genoffice 是一个完整的办公文档处理开源库，提供：

- **docx-engine**：Word 文档解析和渲染的核心引擎
- **file-parse**：多种格式文档的解析
- **html2docx**：HTML 到 Word 的转换
- **font-metrics**：字体度量数据（用于精确排版）
- **i18n**：国际化支持

通过 symlink 方式引入（而非复制或 npm 发布），开发阶段可同步修改两处代码。

### 扩展 vs 直接修改

业务逻辑通过 `extensions/bid-review/` 扩展实现，而非直接修改 `apps/desktop/` 或 `packages/` 代码。好处：

- 保持与上游 pi-gui 的合并能力
- 业务逻辑独立于框架
- 可作为独立模块测试和部署

## 关键组件说明

| 组件            | 来源                             | 用途                                              |
| --------------- | -------------------------------- | ------------------------------------------------- |
| Electron 桌面壳 | pi-gui fork                      | 提供 Agent 对话、工具调用、会话管理等桌面基础设施 |
| Chord 服务框架  | pi-gui (`@earendil-works/chord`) | 定义前后端共享的服务接口和状态同步                |
| 扩展系统        | pi-gui (`ExtensionAPI`)          | 注册工具、命令、桌面视图                          |
| docx-engine     | genoffice                        | Word 文档解析、渲染、编辑                         |
| file-parse      | genoffice                        | 文档格式解析（docx/pdf 等）                       |
| bid-review 扩展 | 本项目                           | 标书审查的核心业务逻辑                            |

## 开发

```bash
# 1. 链接 genoffice 文档引擎包（需要 genoffice 源码在相邻目录）
node scripts/link-genoffice.mjs
# 或者指定 genoffice 路径：
# node scripts/link-genoffice.mjs /path/to/gen-document/feat-workspace

# 2. 安装依赖
pnpm install

# 3. 开发模式
pnpm --filter @bid-workshop/desktop dev

# 4. 构建
pnpm --filter @bid-workshop/desktop build

# 5. 打包
pnpm --filter @bid-workshop/desktop package
```

### genoffice 依赖说明

本项目通过 symlink 方式引入 genoffice 核心包，要求 genoffice 源码位于本地。默认查找路径为 `../gen-document/feat-workspace`（即 bid-workshop 的相邻目录）。可通过 `scripts/link-genoffice.mjs` 的参数覆盖。

## 扩展开发

参考 `examples/desktop-extensions/pr-review/` 和 `examples/desktop-extensions/README.md`。

扩展由三部分组成：

1. **contract.ts** — 用 Chord `defineService` 定义服务接口和状态
2. **index.ts** — 注册工具/命令，通过 `registerDesktopView` 注册桌面视图
3. **desktop.ts** — 纯 DOM 前端（无 React），通过 `host.services.open()` 连接后端

## License

MIT
