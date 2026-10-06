# 壳能力计划（shell milestone）

> 分支：`david-crazyamber/feat-shell`（"壳"）
>
> 这份文档管**一件事**：把「壳 + 引入的 office 文档库」做成一个**独立完整、clone 下来就能跑的标准应用**，
> 并且让文档库的**全部编辑能力在这个仓库里真实可用、可验证**。
>
> **不在范围**：标书审阅业务（`extensions/bid-review`）、工作空间数据模型（公司资料 / 评审条件 / 校验条目）、业务角色。
> 那些是壳建好之后的下一层。
>
> 上游权威文档是 `docs/目标与计划.md`（M0–M6 编号、用户原话）。本文档是它在**「只做壳」**这个收敛范围下的执行版。
> 冲突时以 `docs/目标与计划.md` 第一节的用户原话为准。

---

## 一、本轮用户原话

> 把那个除了业务层我们要实现的那个标书审阅的之外，除了业务层之外的，我们要把**壳程序以及引入的 document 的库的所有能力的验证**，整个我们要全都搞定。
>
> 就是我们**壳本身就是可以运行的**，然后……去把那个**壳本身的能力加上要引入的 office 的所有的编辑能力，都在这个项目内得到体现**，
> 不需不要去给我用什么**别名引用**什么之类的，就是最后**这个地址被别人拿到了之后可以跑起来**。
> 虽然跟标书没有任何关系，但是它已经是一个**标准准准的 APP** 了。
>
> 所以那个**模型的验证链路**也是可以做的，它**可以引入文件，它可以去生成一个文件**，它可以做一个事情，正常一个壳应该做的事情。
>
> 然后**文档的引入，它可以读文档，它可以给文档加一句话**。以前我们有给文档做改动、给文档生成**批阅数据**，所有的一切这些东西全都要完备好。

**我的理解**

| 原话要点                                | 理解                                                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 「除了业务层之外」                      | 标书审阅相关代码可以留在仓库里，但**不允许成为壳能跑起来的前提**；壳不得依赖任何 bid 业务扩展                                |
| 「壳本身就是可以运行的」                | Electron 应用启动 → 打开文件夹 → 会话/模型/技能/MCP 这套 AI harness 可用                                                     |
| 「document 库的所有能力验证」           | genoffice（`vendor/genoffice` + `packages/document-editor`）的**读 / 改 / 存 / 批注 / 修订 / 导出 / 新建**全部接通，不是留桩 |
| 「不要用别名引用」                      | 仓库内不得有指向**本机绝对路径**或仓库外目录的引用；vendor 已是入库的真实 workspace 包，不再靠符号链接                       |
| 「别人拿到地址可以跑起来」              | 干净 clone → `pnpm install --frozen-lockfile` → `pnpm check` → build → 启动，全通                                            |
| 「标准的 APP」                          | 应用身份是我们自己的（appId / productName / 发布配置不再是 pi-gui），打包产物能启动                                          |
| 「模型的验证链路」                      | 真实模型跑通：**读一个文件**、**生成一个文件**、**改一个已存在的文件**                                                       |
| 「读文档 / 加一句话 / 改动 / 批阅数据」 | 打开 .docx → 编辑 → 存回 → 外部（Word/解析器）能看到批注与修订                                                               |

> **一处歧义，我按此处理**：原话「一代仓应该被升级了」我读成「该升的依赖就升（含 Electron），不为兼容旧版本绕路」，
> 与 `docs/目标与计划.md` §9「不行就升版本」一致。若你指的是别的（比如某个具体仓/包），纠正我。

---

## 二、完成定义（Definition of Done）

每条都要有**可执行、可复现**的证据，不接受「看起来好了」。

| 编号    | 定义                     | 证据                                                                                                                                            |
| ------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1**  | 仓库内无本机绝对路径引用 | `git grep -nE '/Users/david\|/home/[a-z]' -- . ':!vendor'` 只命中无关的 svg/xml 命名空间；`.pi/settings.json` 不再指向机外路径                  |
| **D2**  | 干净 clone 可跑          | 在临时目录真 clone 一次，跑 `pnpm install --frozen-lockfile && pnpm check && pnpm --filter @bid-workshop/desktop run build`，全 exit 0          |
| **D3**  | 门禁全绿                 | `pnpm check` 绿；`pnpm test:baseline` 绿；`pnpm --filter @bid-workshop/desktop run test:e2e:core` 无失败                                        |
| **D4**  | 应用身份是我们自己的     | `electron-builder.yml` 的 appId / productName / publish 不再是 pi-gui；`pnpm --filter @bid-workshop/desktop run package` 出来的 .app **能启动** |
| **D5**  | 壳可用                   | 真实 Electron：启动 → 打开文件夹 → 新建会话 → 文件树 → 点文件显示；模型选择器/设置页/技能/MCP 面板可达                                          |
| **D6**  | 文档：读                 | 点 `.docx` 在文件面板渲染出真实内容（已达成，保持）                                                                                             |
| **D7**  | 文档：改 + 存            | 在打开的文档里插一句话 / 改标题 / 列表加一项 → 保存 → **重新从磁盘解析**，改动在文件里，且原有格式未被打碎                                      |
| **D8**  | 文档：批阅数据           | 加批注 → 保存 → **外部**读 `word/comments.xml` 能看到该批注（作者/文本/锚点）；回复 / 标记解决 / 删除同样落盘                                   |
| **D9**  | 文档：修订               | 开修订做改动 → 保存 → 文件里是 `w:ins`/`w:del`；接受/拒绝后再保存，文件随之变化                                                                 |
| **D10** | 文档：新建 / 另存 / 导出 | 新建空白文档 → 存盘成新 .docx 并可再打开；导出 PDF、导出 HTML 产物真实存在且可打开                                                              |
| **D11** | 模型链路                 | **真实 provider**（默认 `qwen/qwen3.7-plus`）跑一轮：让模型读一份 .docx 并回答其中内容 → 通过                                                   |
| **D12** | 模型链路：生成文件       | 真实模型被要求「新建一个 docx 并写入 N 段内容」→ 磁盘上出现该文件，用引擎解析出内容                                                             |
| **D13** | 模型链路：改已存在文档   | 真实模型被要求「往某个 .docx 的某段加一句话 / 加一条批注」→ 文件真的变了，改动可被外部解析出来                                                  |
| **D14** | 无桩                     | `document-preload.ts` 里渲染层**实际会调用**的成员全部有真实现或**明确的、有理由的**不支持返回（并在本文档 §七记录理由）                        |

> D11–D13 需要真实凭据。本机 `~/.pi/agent/models.json` 有 `qwen` / `ds4` / `minimax` 三个 provider，默认 `qwen/qwen3.7-plus`。
> 凭据文件**不读、不打印、不入库**；live lane 通过 `PI_APP_REAL_AUTH=1` + `PI_APP_REAL_AUTH_SOURCE_DIR=~/.pi/agent` 走既有机制。

---

## 三、现状（事实，带路径）

### 3.1 壳体

- `apps/desktop/` 是从 pi-gui 分出来的 Electron 应用。主进程入口 `apps/desktop/electron/main.ts`（1682 行），
  渲染层 `apps/desktop/src/`，preload `apps/desktop/electron/preload.ts`（窄面 `window.piApp`）。
- **AI harness 是壳自己的**：Pi agent、会话、provider/model 配置、技能、MCP、工具、扩展宿主，
  全部由 `DesktopAppStore`（`apps/desktop/electron/application/app-store.ts`）在 `main.ts:1064` 构造。
  **不依赖任何 bid 扩展**（`apps/desktop/package.json` 不含 `@bid-workshop/extension-bid-review`）。
- 壳自带内置 Pi 扩展两个：`pi-gui-thread-orchestration`、`pi-gui-scheduled-tasks`（`main.ts:1043-1062`），
  另有 Pi 的 add-on `builtin:mcp` / `builtin:codemode` / `builtin:tool-search`。
- 工作区 = 打开的文件夹；文件树 `apps/desktop/src/features/workbench/file-explorer.tsx`，
  文件面板 `.../file-editor-pane.tsx`。

### 3.2 文档宿主（已做到「看」）

- `apps/desktop/electron/documents/document-view.ts`（348 行）：每窗口一个 `WebContentsView`，
  用特权协议 `bid-docs://app/` 加载编辑器产物，托管在文件面板矩形之上。
- `apps/desktop/electron/documents/document-channels.ts`（8 行）：scheme + 3 个 IPC 名。
- `apps/desktop/electron/document-preload.ts`（101 行）：往编辑器渲染层暴露 `window.desktop`，
  **76 个成员里只有 1 个是真的**（`consumePendingOpenDocx`），其余 75 个是惰性桩。
- 取字节路径：渲染层 `consumePendingOpenDocx()` → `{path,name,dataUrl,hash}` → 自己 `fetch(dataUrl)`
  → `parseDocxOffThread` → Tiptap 编辑器。
- 位置由应用渲染层上报（`ResizeObserver` + `getBoundingClientRect`），`document-view.ts` 只管 show/hide/bounds。
- 已通过的验证：`apps/desktop/tests/core/document-view.spec.ts`，
  命令 `pnpm --filter @bid-workshop/desktop run test:core:document-view`。

### 3.3 编辑器包（`packages/document-editor/`）

- 只有渲染层；`vite.config.mts`，`root: src/renderer`，`base: "./"`，产物 `dist/`。
- **docx-engine 跑在渲染层里**：`parse-worker.ts` 调 `parseDocx`，`file-actions.ts:727` 调 `saveDocx`。
  宿主只负责**字节搬运**，不解析。
- 渲染层自带的完整能力（都在 `src/renderer/`）：
  - 编辑：Tiptap/ProseMirror 富文本、ribbon（插入/布局/设计/引用）、查找替换
  - **AI 工具注册表** `ai/tools.ts:87` 的 `AGENT_TOOLS`：`read_blocks` / `insert_content` / `replace_blocks` /
    `replace_selection` / `apply_ops` / `read_revisions` / `accept_changes` / `reject_changes` /
    `read_comments` / `add_comment` / `reply_comment` / `resolve_comment` / `delete_comment` /
    `insert_image` / `insert_chart` / `create_document` / `set_header_footer` / 脚注尾注 / 图表 / 图片 / 搜索
  - **ops 引擎** `ai/ops.ts`（`setFont`/`setParagraphFormat`/`setHeadingLevel`/`findReplace`/`deleteBlocks`/
    `moveBlocks`/`setList`/`insertToc`… + 表格/域/批注/修订/脚注/样式各自模块）
  - **批注 UI** `components/CommentsPanel.tsx` + `review-actions.ts`（新建/回复/编辑/解决/删除）
  - **修订** `editor/revisions.ts`（`acceptAllRevisions`/`rejectAllRevisions`/逐个）
  - 保存 `file-actions.ts` 的 `save`/`buildDocBytes`；导出 `exportPdf`/`exportHtml`/`exportImages`；打印 `PrintDialog.tsx`
  - **MCP 桥（渲染层半边）** `mcp-bridge.ts`：监听 `window.desktop.onMcpCommand`，处理
    `insert_content` / `replace_blocks` / `apply_ops` / `add_comment` / `read_comments` / `read_document` / `save_document`
- 渲染层期望 `window.desktop` 的**完整清单**已经盘出来了（见 §五 S3 的表）。

### 3.4 文档引擎（`vendor/genoffice/`）

- 15 个包，全部是 pnpm workspace 成员（`pnpm-workspace.yaml` → `vendor/genoffice/*`），**源码入库、非符号链接**。
- `@genoffice/docx-engine` 关键 API：
  - 读：`parseDocx(bytes, {expandAltChunks})` → `ParsedDoc`（`blocks` / `comments` / `styles` / `numbering` / header-footer / footnotes…）
  - 写：`saveDocx(parsed, finalBlocks: SaveBlock[], options)`；`SaveOptions.comments?: CommentInfo[]`（整表重写）
  - 新建：`buildBlankDocx(...)`
  - 批注：`CommentInfo = {id, author, initials?, date?, text, parentId?, done?, paraId?}`；回复 = `parentId`；解决 = `done:true`；删除 = 从数组移除
  - 修订：`SaveBlock.revision: {kind:'ins'|'del', author, date?}`；`Run.ins`/`Run.del`；**接受/拒绝在渲染层，不在引擎**
  - 结构化批改 = 重排 `finalBlocks`（`{kind:'original'}` 逐字节保留，`{kind:'generated'}` 新造）
- **包没有 build**：`exports` 直接指向 `./src/*.ts`，消费方自己转译。`zip-splice` 是唯一用 `node:zlib` 的子路径（不可进渲染层 bundle）。
- **不存在** `doc_apply_ops` / `doc_insert_content` / `doc_replace_blocks` 这类引擎函数——
  这些名字只存在于 `@genoffice/workspace-harness` 的**工具包装**里（`tools/document-edit.ts`），且要一个 `DocumentEditBridge` 才活。
- `@genoffice/workspace-harness` 根入口在本仓 SDK 版本下**导入会炸**（依赖 `pi-agent-core@0.87.1`，本仓是 1.0.0）；
  只有 `./workspace/*`、`./tools/*`、`./tool/*` 子路径安全。

### 3.5 门禁与工具链

- 根 `package.json`：`check = format:check && lint && check:architecture && typecheck`；
  `typecheck = check:workspaces && build:shared && pnpm -r --if-present typecheck`；`test:baseline = test:guards && 各包 test && test:desktop-unit`。
- 桌面测试 lane：`apps/desktop/package.json` 每条 `test:core:<name>` 展开为
  `pnpm build && cross-env PI_APP_TEST_LANE=core PI_APP_REAL_AUTH=0 PI_APP_TEST_MODE=background playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/core/<name>.spec.ts`。
- 结构门禁（`pnpm check:architecture`）：`check-renderer-boundary` / `check-contract-authority` / `check-host-boundary` / `check-timeline-owner`。
- 守卫测试（`pnpm test:guards`）里**与本任务直接相关**的两条：
  - `scripts/ipc-main-frame-boundary.test.mjs` —— **只有 `electron/ipc/main-frame-ipc.ts` 可以用 `ipcMain`**，
    `ipc/register-desktop-ipc.ts` 对「未列入 14 个 channel 的」是历史豁免。**新增文档 IPC 必须先读这条守卫再决定放哪。**
  - `scripts/state-owner-boundary.test.mjs` —— `writeFileAtomicQueued` 与若干持久化文件名只能在列出的 owner 模块里出现。
- 打包：`apps/desktop/electron-builder.yml`（独立文件）——appId `com.pi-gui.desktop`、productName `pi-gui`、
  `publish.owner: minghinmatthewlam` / `repo: pi-gui`，**仍是上游身份**；`extraResources` 已把 `packages/document-editor/dist` 拷进产物。
- CI：`.github/workflows/ci.yml`。`desktop-package-linux` 第一步跑 `pnpm verify:release-config`，**根 `package.json` 里根本没这个 script** → 必挂。
- 已知失败：`examples/desktop-extensions` 的 4 个示例视图测试；打包 job。

---

## 四、设计决定（先定，再动手）

**F1 — 文档字节走 IPC，不落盘在渲染层。**
渲染层已经算好完整 docx 字节（`buildDocBytes`），宿主的职责是**选路径 + 原子写盘 + 回执**。
`ArrayBuffer` 过 `contextBridge` + `ipcRenderer.invoke` 是可行的；目录由宿主决定，渲染层拿不到任意写权。

**F2 — 写盘有路径策略。**

- `saveDocx(path, bytes)`：`path` 必须等于**当前这份文档被打开时登记的路径**（宿主自己记，不信任渲染层传来的 path）。
- `saveDocxAs` / `saveDocxNew`：路径由**原生保存对话框**决定。
- 写盘用「临时文件 + rename」的原子写法，并保留原文件权限位。
- 所有文档通道都校验 **sender 必须是已登记的文档视图 webContents**（现在 `installIpc()` 完全不校验，这是要修的）。

**F3 — 主进程的「无界面」文档能力（spike 已做，结论如下）。**
理由：D12/D13 需要一条不依赖打开编辑器的路径（AI 生成文件、改文件），
而且这本来就是「库的能力」。

**spike 实测结果（这一条别再重试同样的两次尝试）：**

- **打包这关没问题**：把 `@genoffice/docx-engine` 加进 `electron.vite.config.mjs` 的
  `externalizeDeps.exclude`，它就真的被打进 `out/main/main.js`（963 KB → **2.23 MB**，
  `parseDocx` 与 JSZip 都在产物里）。这证明了主进程能用这个引擎。
- **但主进程的项目没法给它做类型检查**，两条路都试过、都被实测否掉：
  - 主进程的 tsconfig 继承 `NodeNext`，而 vendored 包内部是**无扩展名的相对导入**（bundler 风格）。
    改成 `moduleResolution: bundler` 能读它，但会让 `Response` 这类全局声明换一个来源，
    现有主进程代码立刻冒出 10 个类型错误。
  - 再给 `lib` 加上 DOM 想压住它们，结果把引擎源码整个拖进主进程的严格检查
    （主进程开了 `noUncheckedIndexedAccess`，引擎没开）→ **400 个错**。

**决定**：能力放进**自己的 workspace 包**（自带 tsconfig，按引擎那套设置来，
包内部用带 `.js` 扩展名的相对导入），main 以普通依赖引用它，它再被打进 main bundle。
这样主进程的项目永远看不到引擎源码——`packages/document-editor` 走的也是「自己的 tsconfig + 自己构建」这条路。
（「给 docx-engine 自己加一个 tsc build」也考虑过：它的产物里仍是无扩展名导入，运行时还是不成，故不选。）

**已落地**：`packages/document-service/`（自带 tsconfig，`moduleResolution: bundler`，包内单文件无相对导入问题），
`apps/desktop` 以普通依赖引用它，`electron.vite.config.mjs` 把它连同引擎一起打进 main bundle。
验证：`test:core:document-service` —— 真实 Electron 里主进程读一份 `.docx` 并取出真实文本
（`main.js` 从 963 KB 涨到 2.23 MB，`parseDocx` 确实在产物里）。

**F4 — 编辑能力两条路都接，但各司其职。**

- **活文档（人正在看的）**：走渲染层 MCP 桥（`onMcpCommand`/`reportMcpResult`/`signalMcpReady` + 主进程路由），
  用的是**渲染层自己的 ops 引擎**，保真度最高，改动立刻可见。
- **文件（没打开的 / 批量 / 新建）**：走主进程的 docx-engine 服务。

**F5 — AI 拿到的文档工具由「壳自己的内置 Pi 扩展」提供。**
照 `main.ts:1043` 那两个内置扩展的既有写法加一个（暂名 `pi-gui-documents`），
工具**自己写 schema**（TypeBox / JSON Schema），不引 `workspace-harness`（它的根入口在本仓是坏的，而工作空间是范围外）。

**F6 — 应用身份换成我们自己的。**
`appId` / `productName` / `publish` 改掉；CI 里断言上游发布身份、以及那个不存在的 `verify:release-config`，
要么补实现，要么从 workflow 里删掉——**不留「反正它本来是坏的」这种状态**。

**F7 — core lane 的失败要真修好，不许用「已知失败」了事。**
原计划是把那 4 个上游示例视图的失败当成「不是我们的东西，删掉」。
**实测证明这个判断是错的**：它们失败的原因是 `.gitignore` 把
`examples/desktop-extensions/{github,trace,usage}/dist/desktop.js` 也一起吞了
（另外两个 `pr-review` / `test-runs` 是当年被手工 force-add 进来的，所以它们的 spec 才通过）——
这和 `index.html`、vendor 的 11 个 CSS 是**同一个 bug 的第三次出现**。
处理：`.gitignore` 补 `!examples/desktop-extensions/*/dist/**`，把 3 个 bundle 恢复进来。
教训：**看到「已知失败」，先问一句「它在干净 clone 上到底为什么红」**，别先接受它。

`extensions/bid-review` 保留（业务，范围外，但不许成为壳能跑的前提）。

**F8 — `packages/document-editor/src/**` 尽量一行不改。**
桥由宿主供给是对的。若确实需要改渲染层（例如补一个 `data-state` 供测试等待），
改动必须最小、并在本文档记录原因。

**F9 — typed-lint 守卫要认「整份引入的第三方源码」这一类。**
`scripts/typed-lint.test.mjs` 要求**每个** pnpm workspace 都有 typed lint project，
但 `vendor/genoffice/*` 和 `packages/document-editor/src` 是被**故意**排除在 lint / format 之外的
整份第三方拷贝（`eslint.config.mjs` 的全局 ignore 有注释说明理由），
`calculateConfigForFile` 对它们拿不到规则，于是守卫必红。
处理：守卫里加一份**封闭的**豁免清单 `importedThirdPartyWorkspaces`，
并在仓库根上断言清单里每一项都确实是存在的 workspace——
**新增一个一等 workspace 仍然会失败**，守卫的牙齿没掉。

**F10 — 文档视图的 IPC 从 owner 里搬出来，并且必须校验 sender。**
`document-view.ts` 原来自己 `ipcMain.handle`，违反 `ipc-main-frame-boundary` 守卫。
文档编辑器跑在**自己的 `WebContentsView`** 里，不是窗口的主 frame，
所以用不了 `mainFrameHandler`（它存在的意义是拒绝应用渲染层的子 frame）。
处理：新增 `apps/desktop/electron/ipc/document-view-ipc.ts`，
用一份等价的保证——**只应答 owner 自己创建过的 webContents**；
该模块以说明理由的方式进入守卫的 `rawIpcAllowlist`。
顺带修掉一个真实漏洞：原来这三个 boot channel 对**任何** sender 都应答。

**F11 — 应用身份：改「发布身份」，不改「持久化契约」。**
盘出来的事实分两类：

- **发布身份仍全是上游的**：`electron-builder.yml` 的 `appId: com.pi-gui.desktop`、`productName: pi-gui`、
  `copyright: Copyright 2026 Matthew Lam`、`linux.maintainer/vendor`、`deb.packageName`、
  `publish.owner: minghinmatthewlam / repo: pi-gui`；约 15 个打包脚本里另有产品名/文件名常量；
  `electron/platform/update-checker.ts` 的 `RELEASES_URL` **指向上游仓库——我们的应用会去查上游的更新**，
  对一个独立产品是错的。
- **另一批字符串是持久化契约**：`pi-gui.card` / `pi-gui.pin`（写进会话 JSONL）、`PI_GUI_LEASE_SURFACE`、
  `refs/pi-gui/snapshots/`（写进用户仓库的 git 引用）、`~/.pi-gui/catalogs.json`、一批 localStorage key。
  **改这些只会孤立已有数据，收益为零。**

决定：

1. **改发布身份**：`electron-builder.yml` + 打包脚本里的产品名常量 + `publish` + `update-checker` 的目标。
   产品名用 **`Bid Workshop`**（与仓库名、`@bid-workshop/desktop`、包描述一致），
   `appId` 用 `com.bid-workshop.desktop`。**这是个可以随手改回的产品决定**，换成别的名字只是改字符串。
2. **不动持久化契约**（上面第二类），并记在这里，免得以后有人「顺手统一命名」把用户数据搞丢。
3. Homebrew tap、上游 release workflow 这些**我们不发布的**基础设施，按 `docs/目标与计划.md` §11 处理（不是我们的，删）。

---

## 五、工作项

> 编号 `S*`；每项：做什么 / 动哪里 / 怎么算完成。

### S0 — 基线（先把事实量出来）

1. `pnpm install --frozen-lockfile`
2. 跑并记录：`pnpm check`、`pnpm test:baseline`、`pnpm --filter @bid-workshop/desktop run build`、
   `pnpm --filter @bid-workshop/desktop run test:e2e:core`
3. 把真实失败清单写进本文档 §八（**不是「已知失败」这种二手结论，是自己跑出来的**）

**完成**：四条命令的真实结果（exit code + 失败用例名）记录在案。

### S1 — 独立完整（D1 / D2 / D4）

1. 清掉机外引用：`workspaces/*/.pi/settings.json` 里指向 `/Users/david/_projects/...` 的扩展路径（业务，范围外 → 去掉）；
   删 `scripts/sync-genoffice.mjs`（同步外部项目的脚本，已无用）。
2. 全仓扫 `/Users/`、`/home/`、软链接（`find -type l`），逐个处理。
3. 应用身份（F11）：`electron-builder.yml` 全量换成本项目身份（appId / productName / copyright / 产物名 /
   linux + deb + win 元数据 / publish）；`update-checker` 不再去查上游仓库；mac 的通知 helper 二进制改名；
   打得到的脚本与测试跟着改。本地打包拿不到 Apple 证书，所以 `notarize` 与 `dmg.sign` 关掉（有证书再开）。
   **还没改的**（都只在发版流程里跑、本地跑不到）：
   `apps/desktop/scripts/{verify-release-config.mjs, verify-linux-release.sh, verify-windows-release.ps1,
finalize-macos-release.sh}`、`scripts/{homebrew-tap-utils, release-homebrew-sync, update-homebrew-tap,
verify-homebrew-flow, verify-install-copy}.mjs`、`.github/workflows/release.yml`。
   其中 Homebrew 那一套是**我们根本不发布**的基础设施，按 §11 应当直接删——留作下一步。
   另外 CI 里 `pnpm verify:release-config` 引用了一个**根 `package.json` 里根本不存在的 script**，
   这一步要么补实现、要么删掉，不能留着。
4. 上游示例扩展：按 F7 清掉失败项，core lane 转绿。
5. **Spike**：主进程消费 `@genoffice/docx-engine` 的可行路径（F3）——写一个最小验证（脚本或单测），
   证明「主进程能 `parseDocx` 一个真实 .docx 并 `saveDocx` 回去」。走通哪条路，就把结论写进 §四 F3。
6. 干净 clone 验证（D2）：临时目录 `git clone` 本仓 → install → check → build。

**完成**：D1 / D2 / D4 有证据；§八 更新。

### S2 — 文档宿主：让「改」和「存」真的落盘（D7 / D10）

1. 新增 `apps/desktop/electron/documents/document-io.ts`：
   打开对话框、保存对话框、原子写、权限保留、路径登记（哪份文档对应哪个绝对路径）、最近文件 MRU。
2. 新增文档 IPC（**位置按 `scripts/ipc-main-frame-boundary.test.mjs` 的规则定**，不硬塞）：
   `bid-docs:save` / `save-as` / `save-new` / `save-to` / `write-recovery` / `open` / `open-path` / `create` / `get-recent-files`。
   每个 handler 校验 sender 是已登记的文档视图。
3. 改 `apps/desktop/electron/document-preload.ts`：把上表成员从桩换成真实现（形状严格对齐
   `packages/document-editor/src/shared/ipc.ts` 的类型，尤其是 `saveDocx` 返回的 `{ok, error?, reason?, dataUrl?}`）。
4. 宿主登记「当前文档路径」：`document-view.ts` 的 `show()` 时登记，`hide()`/切换时注销；
   `saveDocx(path, ...)` 只接受等于登记路径的写入。
5. **切换文档前不许丢脏数据**：现在换文件是 `webContents.reload()`（`document-view.ts:117-120`），会直接丢掉未保存内容。
   用渲染层已有的 `onCloseCheck` / `reportCloseCheck` 握手在 reload 前做一次保存或确认。
6. 新建空白文档：`consumeNewBlankDoc` 真实现 + `createDocument` 真实现。

**完成**：D7（改+存+重读一致）、D10 前半（新建/另存）在真实 Electron 上通过，写成 core lane spec。
spec 文件名建议 `apps/desktop/tests/core/document-edit-save.spec.ts`，
断言方式：**保存后用主进程侧的 docx-engine 重新解析磁盘文件**，而不是只看编辑器里显示什么。

### S3 — 文档宿主：把渲染层真正会用到的成员补全

渲染层 `window.desktop` 实际调用点（已盘清，按「挂载必需 / 用户触发」排序）：

**A. 挂载必需（缺了就整棵树挂不上，必须真实现）**
`onLanguageChanged`、`getRecentFiles`、`getAiSettings`、`onRenamedDocx`、`onOpenDocx`、
`consumePendingOpenDocx`（已有）、`consumeNewBlankDoc`、`consumeAiDocContent`、`onZoteroRequest`、
`consumeHeadlessExport`、`onMenuCommand`。
→ 语言/主题接壳的设置；`getAiSettings` 映射壳的 provider/model 配置；`onZoteroRequest` 提供真订阅（可以不发事件）。

**B. 文档生命周期与保存**：S2 已覆盖。

**C. 导出与打印（D10 后半）**
`exportPdf` / `exportHtml` / `print` / `printPdfBuffer` / `saveMergedPdf` /
`pickExportImagesTarget` / `takeExportPdf` / `writeExportImage` / `saveImageAs` / `onViewImage` / `pickImage` / `copyImageToClipboard`。
→ 渲染层自己算 PDF/HTML，宿主只负责**给路径 + 写文件 + 打印**。打印走文档视图自己的 `webContents.print`。

**D. 壳 ↔ 编辑器外壳**：
`onMenuCommand`（壳的应用菜单 → 文档视图，含 ⌘S / ⌘⇧S / ⌘P / ⌘F / 加批注 / 接受修订…）、
`onChromePressed`、`reportViewMenuState`、`onTeardown`、
`onCloseCheck` / `reportCloseCheck` / `onCloseSaveRequest` / `reportCloseSaveResult`（关窗脏数据握手）、
`openNewTab` / `listDocsTabs` / `focusDocsTab`（宿主是「一窗一文档视图」，要么实现多视图，要么给出**明确的单文档语义**并记录）。
→ 菜单/快捷键这项同时决定「这像个正常 APP」的观感，不要省。

**E. 偏好与杂项**：`getAutoSaveDefault` / `onAutoSaveDefaultChanged`、`getAiPanelPrefs` / `setAiPanelPrefs` / `onAiPanelPrefsChanged`、
`respellKick` / `spellDiag`、`fontMetrics`、`aiChat` / `setAiSettings`（后两个声明的契约里有、渲染层不调，可保留桩）。

**F. 编辑器自带 AI 面板（Tier 3，最后做）**：
`aiStream` / `onAiStream` / `aiStreamCancel`、`webSearch` / `imageSearch` / `analyzeMedia` / `aiGenerateImage` / `fetchImage`、
`pickAttachments` / `addAttachmentPaths` / `addPastedImage` / `readAttachment` / `readAttachmentImage` / `getPathForFile`、
`window.projectApi`（聊天记录）。
→ `aiStream` 可以映射到壳的 provider（`@genoffice/ai-provider` 已在 vendor 里，壳也有 provider 配置）；
搜索/生图这类外部服务没有就**明确返回不支持**，并在 §七 记录理由。
`projectApi` 没暴露是渲染层的已知空缺（它自己是可选读的）——**记录**，不阻塞。

**完成**：D14；A/C/D 三组有 core lane 覆盖。

### S4 — 批注与修订真的落盘（D8 / D9）

1. 批注：确认「加/回复/解决/删除 → 保存」整条链在宿主侧免费拿到（渲染层已经算好 `SaveOptions.comments`），
   要验证的是**写盘后的文件**。
2. 修订：渲染层的 `accept_changes` / `reject_changes` 与修订开关 → 保存 → 文件里是 `w:ins`/`w:del`。
3. 新增 core lane spec：
   - `apps/desktop/tests/core/document-comments.spec.ts`
   - `apps/desktop/tests/core/document-revisions.spec.ts`
     **断言方式：解压 .docx 直接看 `word/comments.xml` / `word/commentsExtended.xml` / `word/document.xml`**，
     以及用 docx-engine 解析 `comments[]`。这条最不容易造假，必须这么做。

**完成**：D8 / D9 有证据。

### S5 — 活文档的 AI 桥 + 壳自己的文档工具（D12 / D13 的前提）

1. **主进程侧路由**：`apps/desktop/electron/documents/document-mcp-bridge.ts`——
   往指定文档视图发 `onMcpCommand`，等 `reportMcpResult`，带 requestId 与超时；视图销毁要清理挂起请求。
2. **preload** 补 `onMcpCommand` / `reportMcpResult` / `signalMcpReady`（这三个一齐补齐，渲染层的 `installMcpBridge` 才会激活）。
3. **壳的内置 Pi 扩展 `pi-gui-documents`**（照 `main.ts:1043` 的写法），工具大约：
   - `docx_read`（无界面读，docx-engine）
   - `docx_create`（无界面新建并写内容）
   - `docx_patch`（无界面结构性改动 / 批注）
   - `doc_edit_open` / `doc_read_open` / `doc_save_open`（路由到活文档的 MCP 桥）
     工具 schema 自己写；描述里写清「活文档用哪一个、文件用哪一个」。
4. `apps/desktop/electron/documents/document-service.ts`：无界面文档服务（F3 的落地）。

**完成**：core lane spec `apps/desktop/tests/core/document-ai-edit.spec.ts` 直接驱动 MCP 桥改文档并落盘；
外加 `apps/desktop/tests/unit/` 里对无界面服务（新建/读/改/批注）的单测。

### S6 — 模型链路（D11 / D12 / D13）

1. live lane spec（按 `apps/desktop/tests/AGENTS.md` 的规则：`PI_APP_REAL_AUTH=1` + `PI_APP_REAL_AUTH_SOURCE_DIR`，
   全跳过要报失败，不许假装成功）：真实 provider 跑三轮——读文档 / 生成文档 / 改文档加批注。
2. **不许**把凭据、真实客户名、合同金额写进仓库（本仓是公开的）。
3. 记录实际用的 provider/model 与时间，写进 §八。

**完成**：D11 / D12 / D13 有证据。

### S7 — 收口

1. `docs/目标与计划.md` §八加一行指针，指向本文档（让新会话知道「壳」这条线在哪）。
2. 全量回归：`pnpm check`、`pnpm test:baseline`、`pnpm --filter @bid-workshop/desktop run test:e2e:core`、干净 clone（D2）、打包冒烟（D4）。
3. 提交：小步、聚焦，每步都过门禁。

---

## 六、顺序与依赖

```
S0 基线
 └─ S1 独立完整（D1/D2/D4）         ← 可与 S2 并行，但 S1.5 的 spike 结论喂给 S5
     └─ S2 改+存（D7/D10前）        ← 一切的地基
         ├─ S3c/d 导出+菜单          ← 让壳「像正常 APP」
         └─ S4 批注/修订（D8/D9）
             └─ S5 活文档 AI 桥 + 壳的文档工具
                 └─ S6 模型链路（D11/D12/D13）
                     └─ S7 收口
```

S3 的 A 组（挂载必需）**要先于** S4，因为 `getAiSettings` 这类缺了会让整棵树挂不上。

---

## 七、「不支持」，以及为什么（当前）

> 每一条都要求：**渲染层调用它会得到一个形状正确的、不会被误当成功的返回**，而不是静默挂起。
> 随着工作推进，这张表要么变短，要么写清为什么留。

| 成员                                                                                             | 现状 | 打算                                                                    |
| ------------------------------------------------------------------------------------------------ | ---- | ----------------------------------------------------------------------- |
| `openDocxDecrypt` / `setDocPassword` / `docPasswordIntentRevision` / `discardDocPasswordIntents` | 桩   | 待 S3 定：引擎有 `protection.ts`；加密文档要么支持，要么返回明确 reason |
| `webSearch` / `imageSearch` / `analyzeMedia` / `aiGenerateImage`                                 | 桩   | 外部服务不在本仓；**明确返回 `unavailable`**，S3F 时定                  |
| `zoteroCommand`                                                                                  | 桩   | Zotero 是外部应用集成，与本仓的「文档编辑能力」无关；明确返回不支持     |
| `aiGskLogin` / `aiGskStatus`                                                                     | 桩   | 第三方账号体系，同上                                                    |
| `fontMetrics` / `aiChat` / `setAiSettings`                                                       | 桩   | 渲染层不调用（契约里有）；保留桩即可                                    |

---

## 八、跑出来的事实（每轮更新）

### 8.1 基线（S0，2026-10-06 实测）

**初始状态**（`pnpm install --frozen-lockfile` 通过、8.4s；未改任何源文件）：

| 命令                                                              | 初始结果                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm check`                                                      | ❌ 停在 `format:check`（本文档没过 prettier，是我刚加的，修完即绿） |
| `pnpm test:baseline`                                              | ❌ 6 个失败                                                         |
| `pnpm --filter @bid-workshop/desktop run build`                   | ❌ **失败**                                                         |
| `pnpm --filter @bid-workshop/desktop run test:core:document-view` | 没跑到（依赖 build）                                                |

**最重的一条：干净 clone 下编辑器包根本编不出来。** 根因是两个**从未提交**的文件：

1. `packages/document-editor/src/renderer/index.html`（Vite 入口）——
   被 `.gitignore` 里裸的 `index.html` 规则吞掉。
   症状：`vite build` 报 `Could not resolve entry module "src/renderer/index.html"` →
   编辑器编不出来 → 挂不上壳 → **连「看」都复现不了**。
2. `vendor/genoffice/ui/src/*.css`（11 个共享样式表）——
   `*.css` 规则给 `apps/` `packages/` `extensions/` 都开了口子，**唯独漏了 `vendor/`**。
   症状：编辑器的共享样式整片丢失。

两份文件都从原始 checkout（`/Users/david/_projects/1_company/ai-projects/bid-workshop-new`，分支 `main`）
**逐字节恢复**；`.gitignore` 补 `!packages/*/src/**/index.html` 与 `!vendor/**/*.css`。

**其余失败与处理：**

| 失败                                                                                       | 原因                                                                                                                                                         | 处理                                                                                  |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `ci-guards` / `typed-lint`：`video/src/Root.tsx` 无匹配配置                                | 上游的营销视频包不在本仓                                                                                                                                     | 从两处路径表删掉                                                                      |
| `typed-lint`：`packages/document-editor` + 15 个 `vendor/genoffice/*` 缺 typed project     | 它们是**故意**排除的整份第三方拷贝                                                                                                                           | F9                                                                                    |
| `ipc-main-frame-boundary`：`documents/document-view.ts` 直接用了 `ipcMain`                 | 真违规                                                                                                                                                       | F10                                                                                   |
| `contract-resolution` 两条                                                                 | 只是 `pnpm check` 提前挂、`build:shared` 没跑、`packages/*/dist` 不存在                                                                                      | 顺序问题，非缺陷                                                                      |
| `packages/{catalogs,extension-ui,pi-sdk-driver} test`：`ERR_UNKNOWN_FILE_EXTENSION ".mts"` | 本机 pnpm 全局钉 `use-node-version=22.15.0`，该版本还没默认类型剥离；CI 是 `node-version: 22`（最新 22.x 已默认）                                            | 三个包的 test 脚本显式加 `--experimental-strip-types`（22.6+ 都有，新版为无害 no-op） |
| `app-operations.spec.ts`：期望相对路径，实到 `../../..` 拼出来的绝对路径                   | **真 bug**：`resolveExistingWorkspacePath` 返回 realpath 后的文件，调用方却拿**未解析**的根去算相对路径；macOS 上 `/var/folders` 实为 `/private/var/folders` | 新增 `resolveExistingWorkspaceFile`，同时返回解析后的根与文件，调用方据此算相对路径   |

**修完之后的基线：**

| 命令                                                              | 结果                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm check`                                                      | ✅ 绿                                                                                             |
| `pnpm test:baseline`                                              | ✅ 绿（守卫 108/108、catalogs 29/29、pi-sdk-driver 165/165、extension-ui 9/9、desktop unit 全绿） |
| `pnpm --filter @bid-workshop/desktop run build`                   | ✅ 绿                                                                                             |
| `pnpm --filter @bid-workshop/desktop run test:core:document-view` | ✅ `1 passed` —— 「看」终于能在干净 clone 上复现                                                  |

### 8.2 已完成的判定

- **D3 达成**：`pnpm check` ✅、`pnpm test:baseline` ✅（守卫 108/108、catalogs 29/29、pi-sdk-driver 165/165、extension-ui 9/9、desktop unit 340 过 + 1 跳过）。
- **D6 达成**：干净 clone 上点 `.docx` 渲染出真实文档内容（core lane spec 通过）。
- **core lane 全绿**：`pnpm --filter @bid-workshop/desktop run test:e2e:core` → **293 passed / 0 failed**（14.6 分钟）。
  它是从「7 个失败」过来的，而这 7 个**全都是真 bug，没有一个该被当成「已知失败」**：
  - 4 个示例视图（github / trace / usage）：三个 bundle 被 `.gitignore` 吞掉（见 F7）。
  - 2 个 `new-thread-composer` + 1 个 `orchestration-runtime-tools`：本机 `ANTHROPIC_AUTH_TOKEN`
    泄漏进夹具环境，provider 被当成「已连接」。夹具补进 scrub 清单后即绿。
- **D2 达成**：临时目录真 clone → `pnpm install --frozen-lockfile`（5.8s）→ `pnpm check` ✅ → build ✅，
  `packages/document-editor/dist/index.html` 与 `apps/desktop/out/main/main.js` 都在。
- **D4 达成**：`electron-builder.yml` 全量换成本项目身份；`package:dir` 产出
  `apps/desktop/release/mac-arm64/Bid Workshop.app`；production 的 **packaged smoke 通过**
  （真实启动打包后的 app 并起了一个线程）。
  注意：**打包 app 的第一次启动握手动用了 180s**（未签名的新 bundle 被 macOS 首次评估），第二次 3.4s。
  这不是产品问题，但会让任何「打包后第一次跑」的测试看起来像超时。
- **顺带修掉一个真缺陷**：`vendor/genoffice/workspace-harness` 把 `@earendil-works/pi-*` 钉死在 `0.87.1`，
  pnpm 因此同时装了两套 SDK；electron-builder 的收集器只拷根层那一份旧版本 →
  打包产物里 `@earendil-works/pi-telemetry` 缺失、`openai` 还是 6.40（而 pi-ai 要 7.19）。
  把 pin 放到 `^1.0.0` 之后整套 SDK 只剩 1.0.0，lockfile 少 62 行；打包依赖校验与 packaged smoke 都过了。
  代价是它的 agent 层要跟着适配：1.0.0 把 `estimateContextTokens` 从 `pi-agent-core` 移走，
  改成 `pi-coding-agent` 里**按单条消息**计数的 `estimateTokens`，
  于是 `pruneTranscript` 的「整段 token 数」改成自己求和（语义不变）。
- 还欠：D1 的收尾（发版流水线里还留着上游名字）、D5、D7–D14。

### 8.3 踩过的坑 / 结论

- **`.gitignore` 里裸的文件名/扩展名规则会静默吞掉源码——这次出现了三次。**
  `index.html`、vendor 的 11 个 `.css`、3 个示例 bundle。**没有任何一道门禁会报**：
  `pnpm check` 绿、`test:baseline` 绿，只有**真在干净 clone 上跑 build、再跑一遍全套 spec**才暴露。
  流程结论：**动过 `.gitignore` 之后，必须在干净 clone 上重跑 build 和 core lane。**
- **「已知失败」这四个字有毒。** 交接文档写着那 4 个示例视图失败「在我这轮改动之前就已经在失败，与本项目无关，别去修」。
  实测下来是同一类「从未提交的文件」。**下次看到「已知失败」，先单独跑一遍、问清它到底为什么红。**
- **本机的 node 与 CI 的 node 不是一个。** pnpm 被全局配置钉在 `use-node-version=22.15.0`
  （`pnpm exec node --version` → 22.15.0，而 shell 里的 `node` 是 22.23.1）。
  仓库脚本依赖 Node 的默认类型剥离（22.18+），所以出现「CI 绿、本机红」。排障第一步：确认跑的是哪个 node。
- **开发机上的 provider 凭据会污染夹具测试。** 夹具的 scrub 清单漏了 `ANTHROPIC_AUTH_TOKEN`，
  一条环境变量就让 3 个 spec 红——而且失败信息里看不出任何和凭据有关的东西。
- **一个「不常用的 vendored 包」能把整个打包产物搞坏。** 依赖冲突不会在 `pnpm check` 或 core lane 里露头，
  只有 `verify:packaged-runtime-deps` 会查——而它此前从没在能跑的环境里跑过。
  **结论：打包后必须跑 `verify:packaged-runtime-deps` + packaged smoke，不能只跑 dev 的那套。**

### 8.4 下一步的方向

- S1 收尾：发版流水线里剩下的上游名字（见 S1.3 的清单）。
- **S2 起：把「改」和「存」接通（D7/D10）** —— 再批注 / 修订（D8/D9），再活文档 AI 桥（S5），最后真实模型链路（S6）。
  也就是：目标里最核心的那一半还没动。

### 8.5 D1–D14 逐条状态（最后更新：本轮）

| 编号 | 定义                                  | 状态                    | 证据 / 缺口                                                                                                                                                                                                                                                                                                                                          |
| ---- | ------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1   | 仓库内无本机绝对路径引用              | ✅                      | 全仓扫描：`vendor` / lockfile / 文档之外只剩 3 处，**全是假路径的测试夹具**（`/Users/pi` 当假 HOME、一条「不得出现 `/Users/`」的断言、一条假输入路径）。唯一的软链是仓内相对的 `CLAUDE.md -> AGENTS.md`。文档里剩下的 `/Users/david/...` 是**历史叙述**（原始 checkout 的位置、仓库外公司资料的位置），不是构建依赖                                  |
| D2   | 干净 clone 可跑                       | ✅                      | 临时目录真 clone → `pnpm install --frozen-lockfile`（5.8s）→ `pnpm check` ✅ → build ✅，关键产物齐全                                                                                                                                                                                                                                                |
| D3   | 门禁全绿                              | ✅                      | `pnpm check` ✅、`pnpm test:baseline` ✅（340 passed）、core lane ✅ **293 passed / 0 failed**（依赖改动之后又完整重跑过一遍）                                                                                                                                                                                                                       |
| D4   | 应用身份换成自己的 + 打包 .app 能启动 | ✅                      | `package:dir` → `release/mac-arm64/Bid Workshop.app`；`verify:packaged-runtime-deps` ✅；production 的 packaged smoke ✅（真实启动打包产物并起了线程）                                                                                                                                                                                               |
| D5   | 壳可用                                | ✅（由 core lane 覆盖） | 启动 / 打开文件夹 / 新建会话 / 文件树 / 设置页 / 技能 / MCP 都有 core lane spec 在跑且全过；**没有单独再走一遍人工冒烟**                                                                                                                                                                                                                             |
| D6   | 文档：读                              | ✅                      | `pnpm --filter @bid-workshop/desktop run test:core:document-view` 通过，断言的是真实文档内容                                                                                                                                                                                                                                                         |
| D7   | 文档：改 + 存（重读一致）             | ✅                      | 新增 `test:core:document-edit-save`：往文档里打一句 ASCII 探针 → 走菜单保存 → 文件 sha256 变了、`word/document.xml` 里查得到那句话 → **重新打开仍渲染出来**。为此接通了保存族（原地保存 / 另存 / 首次保存 / 存到指定路径 / 崩溃恢复副本）、最近文件，以及 **File 菜单的 Save / Save As（⌘S / ⌘⇧S）**——渲染层本来就没有保存按钮，不接菜单就没人能保存 |
| D8   | 文档：批注落盘且外部可读              | ✅                      | 新增 `test:core:document-comments`：走真实 UI（插入批注 → 写 → 提交）→ 保存 → 从文件里读出 `word/comments.xml`，断言批注文本、作者 `w:author="User"`，以及正文用 `commentRangeStart` 锚住它。宿主侧一行没改——渲染层本来就构建 `SaveOptions.comments`，D7 打通的保存链路直接带出去了                                                                  |
| D9   | 文档：修订落盘（接受/拒绝）           | ⚠️ 一半                 | `test:core:document-revisions` 覆盖「开修订做改动 → 保存 → 文件里是 `<w:ins>`，且文本保留」。**「接受/拒绝」这一半没覆盖**，原因见 §8.6：编辑器对一份零修订的文档报出 147 条修订，接受全部也不减少                                                                                                                                                   |
| D10  | 文档：新建 / 另存 / 导出              | ⚠️ 一半                 | 另存（原生对话框）、首次保存（写进 `~/Documents` 并避开重名）、存到指定路径都已实现且有通道；**导出 PDF/HTML 与打印仍是桩**，新建空白文档（`consumeNewBlankDoc`）也还是桩                                                                                                                                                                            |
| D11  | 模型链路：真实 provider 读文档        | ❌ 未开始               |                                                                                                                                                                                                                                                                                                                                                      |
| D12  | 模型链路：生成文件                    | ❌ 未开始               |                                                                                                                                                                                                                                                                                                                                                      |
| D13  | 模型链路：改已存在文档 + 加批注       | ❌ 未开始               |                                                                                                                                                                                                                                                                                                                                                      |
| D14  | 无遗留桩                              | ⚠️ 一半                 | 保存族已经真实现；渲染层实际调用、但仍为桩的成员见 §七                                                                                                                                                                                                                                                                                               |

**一句话**：**底座（D1–D6）全部立住，文档的「改 + 存」也通了（D7）；D10 一半（另存/首次保存已通，导出/打印/新建空白还是桩）；剩下的是批注 / 修订 / 导出与模型链路。**

**离开文档时的保存**：换文件 / 换标签会让文档视图 `reload`，所以现在**先保存再离开**——用的是渲染层早已备好的 `onCloseCheck` / `onCloseSaveRequest` 握手。新增 `test:core:document-switch-save`：打完字之后**先断言文件还没变**（证明是「离开」这个动作保存的），再点另一个文件，断言文件变了、探针在 `word/document.xml` 里、而且视图确实被隐藏了（守卫没把面板卡住）。

**这个守卫踩的坑值得单独记**：它**被并发调用了两次**（面板效应的清理 + 新效应体各调一次 `hideDocumentView`），两个握手的「释放旧请求」互相踩，导致第一个 hide 提前把 `currentPath` 清空，渲染层随后真正发出的保存被拒（`save refused: open=null`）——**外面看到的只是「切换后文件没变」，没有报错、没有日志**。
修法：同一个视图上只跑一个守卫，后来者共享同一个 promise。
能定位到它，靠的是**给守卫加临时追踪、把 app 的 stderr 抓进测试输出**，不是靠读代码。

---

### 8.6 已知的库缺陷（不是宿主的缺口）

**修订的「接受 / 拒绝」在编辑器里失效。** 证据链：

- 干净样例 `workspaces/bid-sample/投标文件-某软件科技.docx` 里**一条修订标记都没有**——
  实测 `w:ins` / `w:del` / `w:rPrChange` / `w:pPrChange` / `w:moveFrom` / `w:moveTo` 全部为 0。
- 但在编辑器里打开它，审阅页的「接受」按钮提示 **「接受修订(共 147 条)」**。
- 点「接受所有修订」之后，计数**仍然是 147**；接着保存，文件确实被重写，但 `<w:ins>` 还在里面。
- 渲染层 `review-actions.ts` 的 `handleRevision` 确实调用了 `acceptAllRevisions` 并置了脏标记
  （所以「保存没发生」这条被排除了），问题在 `editor/revisions.ts` 的修订**检测**（147 条幻影），
  不是宿主桥缺东西。

影响：`test:core:document-revisions` 只覆盖了「开修订做的改动会以 `w:ins` 落进文件」这一半；
「接受 / 拒绝后再保存」这一半**没有覆盖**，而且在检测修好之前覆盖不了。

修它要动渲染层的修订检测，按 F8 属于「另一件事」——记在这里，免得被当成已完成。

## 九、不许做的事

- 不许用 iframe 把编辑器再包一层（`docs/目标与计划.md` §11 已排除）。
- 不许为了「新旧版本兼容」绕路；不行就升版本。
- 不许往仓库里加指向本机/机外目录的引用（别名、软链接、绝对路径）。
- 不许把 `extensions/bid-review`（业务）变成壳能跑的前提。
- 不许把桩返回 `{ok:true}` 当成「接通了」。
- 不许在 CI 里留「本来就是坏的」这种豁免；要么修，要么明确删掉并在本文档记录。
- 不许提交真实客户名、合同金额、凭据。
