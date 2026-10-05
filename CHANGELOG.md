# Changelog

## [0.1.0] - 2026-10-05

### 项目初始化

- Fork pi-gui 作为 Electron 桌面壳
- 品牌重命名：`@pi-gui/*` → `@bid-workshop/*`
- 移除 website 和 video 模块（不需要）
- 通过 symlink 引入 genoffice 核心包（docx-engine, file-parse, html2docx, font-metrics, i18n, pptx-engine）
- 创建 `extensions/bid-review/` 标书审查扩展骨架
- 调整 pnpm workspace 配置以支持 extensions 和 vendor 目录

### 架构决策

1. **选用 pi-gui 作为壳**：对比了多个开源 Agent 桌面框架后，选择 pi-gui 作为基础，因为它是目前最成熟的生产级方案
2. **symlink 方式引入 genoffice**：开发阶段通过 symlink 保持代码同步，后续可改为 npm 包或 git submodule
3. **扩展模式承载业务逻辑**：遵循 pi-gui 的扩展模式（contract + index + desktop），将标书审查作为独立扩展
