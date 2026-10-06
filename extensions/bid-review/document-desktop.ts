import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { DesktopViewContext } from "@bid-workshop/extension-ui/browser";
import { BidReview, type BidBodyBlock, type BidIssue, type BidReviewState } from "./contract";

/**
 * The document surface: the loaded bid as it was parsed, with each finding
 * shown against the paragraph it was anchored to. The review panel is where a
 * review is started; this view is where its result lands on the document.
 */
export async function mount(
  root: HTMLElement,
  host: DesktopViewContext,
): Promise<() => Promise<void>> {
  const doc = root.ownerDocument;
  const style = doc.createElement("style");
  style.textContent = `
    .bid-doc{font:13px/1.7 ui-sans-serif,system-ui,sans-serif;color:var(--fg);background:var(--bg);min-height:100%;padding:16px;box-sizing:border-box;overflow-wrap:anywhere}
    .bid-doc *{box-sizing:border-box}
    .bid-doc h2{font-size:15px;margin:0 0 4px;font-weight:600}
    .bid-doc p{margin:0 0 10px}
    .bid-doc .bid-meta{font-size:12px;opacity:.65}
    .bid-doc .bid-notice{padding:10px 12px;border:1px solid color-mix(in srgb,var(--fg) 18%,transparent);border-radius:6px;font-size:12px;margin:12px 0}
    .bid-doc .bid-blocks{margin-top:14px;border-top:1px solid color-mix(in srgb,var(--fg) 14%,transparent)}
    .bid-doc .bid-block{padding:7px 0;border-bottom:1px solid color-mix(in srgb,var(--fg) 8%,transparent);display:grid;grid-template-columns:44px 1fr;gap:10px}
    .bid-doc .bid-idx{font-size:11px;opacity:.4;font-variant-numeric:tabular-nums;padding-top:2px}
    .bid-doc .bid-text{margin:0;white-space:pre-wrap}
    .bid-doc .bid-h1{font-size:15px;font-weight:600}
    .bid-doc .bid-h2{font-size:13.5px;font-weight:600}
    .bid-doc .bid-table{font-family:ui-monospace,SFMono-Regular,monospace;font-size:11.5px;opacity:.85}
    .bid-doc .bid-comment{margin-top:7px;padding:8px 10px;border-left:3px solid var(--accent);border-radius:0 6px 6px 0;background:color-mix(in srgb,var(--accent) 8%,transparent);font-size:12px}
    .bid-doc .bid-comment .bid-c-head{font-weight:600;margin-bottom:3px}
    .bid-doc .bid-comment .bid-c-body{margin:0;white-space:pre-wrap;opacity:.9}
    .bid-doc .bid-sev{display:inline-block;font-size:10px;padding:1px 6px;border-radius:3px;margin-right:6px;font-weight:500}
    .bid-doc .bid-sev.critical{background:rgba(213,75,75,.15);color:#d54b4b}
    .bid-doc .bid-sev.warning{background:rgba(197,139,22,.15);color:#c58b16}
    .bid-doc .bid-sev.info{background:rgba(80,140,220,.15);color:#508cdc}
  `;

  const view = doc.createElement("section");
  view.className = "bid-doc";
  view.style.setProperty("--bg", host.theme.background);
  view.style.setProperty("--fg", host.theme.foreground);
  view.style.setProperty("--accent", host.theme.accent);
  view.style.colorScheme = host.theme.mode;
  root.append(style, view);

  let active = true;
  let hydrated = false;
  let loadedFileId: string | null = null;
  let blocks: BidBodyBlock[] | null = null;
  let bodyError: string | null = null;

  const binding = host.services.open({
    services: [BidReview],
    assertAccess: () => host.signal.throwIfAborted(),
    onError: (error) => {
      renderError(error.message);
    },
  });
  const service = binding.use(BidReview);

  function renderError(message: string) {
    view.replaceChildren();
    const p = doc.createElement("p");
    p.textContent = message;
    p.className = "bid-notice";
    view.appendChild(p);
  }

  const SEVERITY_LABEL: Record<BidIssue["severity"], string> = {
    critical: "严重",
    warning: "警告",
    info: "提示",
  };

  function findingsFor(issues: BidIssue[], blockIndex: number): BidIssue[] {
    return issues.filter((issue) => issue.location?.blockIndex === blockIndex);
  }

  function commentCallout(issue: BidIssue): HTMLElement {
    const box = doc.createElement("div");
    box.className = "bid-comment";
    box.dataset.finding = issue.id;

    const head = doc.createElement("div");
    head.className = "bid-c-head";
    const sev = doc.createElement("span");
    sev.className = `bid-sev ${issue.severity}`;
    sev.textContent = SEVERITY_LABEL[issue.severity];
    head.append(sev, doc.createTextNode(issue.title));
    box.appendChild(head);

    const body = doc.createElement("p");
    body.className = "bid-c-body";
    body.textContent = issue.suggestion
      ? `${issue.description}\n建议：${issue.suggestion}`
      : issue.description;
    box.appendChild(body);
    return box;
  }

  function renderBlock(block: BidBodyBlock, issues: BidIssue[]): HTMLElement {
    const row = doc.createElement("div");
    row.className = "bid-block";
    row.dataset.block = String(block.index);

    const idx = doc.createElement("div");
    idx.className = "bid-idx";
    idx.textContent = String(block.index);
    row.appendChild(idx);

    const cell = doc.createElement("div");
    const text = doc.createElement("p");
    const levelClass = block.type === "heading" ? (block.level <= 1 ? " bid-h1" : " bid-h2") : "";
    text.className = `bid-text${levelClass}${block.type === "table" ? " bid-table" : ""}`;
    text.textContent = block.text;
    cell.appendChild(text);

    for (const issue of findingsFor(issues, block.index)) {
      cell.appendChild(commentCallout(issue));
    }

    row.appendChild(cell);
    return row;
  }

  function render() {
    if (!active || host.signal.aborted) return;
    const state: BidReviewState | undefined = hydrated ? service.state.value : undefined;
    view.replaceChildren();

    const h2 = doc.createElement("h2");
    h2.textContent = "投标文件";
    view.appendChild(h2);

    if (!state) {
      const p = doc.createElement("p");
      p.textContent = "正在连接 Pi 扩展…";
      p.className = "bid-meta";
      view.appendChild(p);
      return;
    }

    const file = state.loadedFiles[state.loadedFiles.length - 1];
    if (!file) {
      const p = doc.createElement("p");
      p.textContent = "还没有加载标书：请在「Bid Review」面板里加载。";
      p.className = "bid-notice";
      view.appendChild(p);
      return;
    }

    const meta = doc.createElement("p");
    meta.className = "bid-meta";
    meta.textContent = `${file.name}：${file.blockCount} 个块，${file.tableCount} 张表，${file.charCount} 字`;
    view.appendChild(meta);

    const found = state.issues.length;
    const anchored = state.issues.filter(
      (issue) => issue.location?.blockIndex !== undefined,
    ).length;
    const status = doc.createElement("p");
    status.className = "bid-meta";
    status.dataset.reviewStatus = state.reviewStatus;
    status.textContent =
      found === 0
        ? state.reviewStatus === "reviewing"
          ? "审查进行中：结论会逐条出现在对应段落旁。"
          : "尚未审查。"
        : `已发现 ${found} 条问题，其中 ${anchored} 条可定位到段落（下方以批注形式标出）。`;
    view.appendChild(status);

    if (bodyError) {
      const err = doc.createElement("p");
      err.className = "bid-notice";
      err.textContent = `读取正文失败：${bodyError}`;
      view.appendChild(err);
      return;
    }

    if (!blocks) {
      const p = doc.createElement("p");
      p.className = "bid-meta";
      p.textContent = "正在读取正文…";
      view.appendChild(p);
      return;
    }

    const list = doc.createElement("div");
    list.className = "bid-blocks";
    list.dataset.document = file.name;
    for (const block of blocks) {
      list.appendChild(renderBlock(block, state.issues));
    }
    view.appendChild(list);
  }

  async function ensureBody(state: BidReviewState) {
    const file = state.loadedFiles[state.loadedFiles.length - 1];
    if (!file || file.id === loadedFileId) return;
    loadedFileId = file.id;
    blocks = null;
    bodyError = null;
    render();
    try {
      const result = await service.readDocument({ fileId: file.id }, BACKGROUND_CONTEXT);
      if (!active || host.signal.aborted) return;
      blocks = result.blocks;
    } catch (error) {
      bodyError = error instanceof Error ? error.message : String(error);
    }
    render();
  }

  const unsubscribeState = () => {};
  let unsubscribe = unsubscribeState;

  /** Surface a failed read instead of leaving a rejected promise. */
  function reportFailure(error: unknown) {
    bodyError = error instanceof Error ? error.message : String(error);
    render();
  }

  function onState() {
    const state = service.state.value;
    if (state) ensureBody(state).catch(reportFailure);
    render();
  }

  function abort() {
    active = false;
  }
  host.signal.addEventListener("abort", abort, { once: true });

  try {
    await binding.ready(BACKGROUND_CONTEXT);
    host.signal.throwIfAborted();
    hydrated = true;
    unsubscribe = service.state.subscribe(() => onState());
    onState();
  } catch (error) {
    unsubscribe();
    await binding.dispose(BACKGROUND_CONTEXT);
    root.replaceChildren();
    throw error;
  }

  return async () => {
    active = false;
    unsubscribe();
    host.signal.removeEventListener("abort", abort);
    await binding.dispose(BACKGROUND_CONTEXT);
    style.remove();
    view.remove();
  };
}
