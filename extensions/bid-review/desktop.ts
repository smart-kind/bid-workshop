import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { DesktopViewContext } from "@bid-workshop/extension-ui/browser";
import { BidReview, type BidReviewState } from "./contract";

export async function mount(
  root: HTMLElement,
  host: DesktopViewContext,
): Promise<() => Promise<void>> {
  const doc = root.ownerDocument;
  const style = doc.createElement("style");
  style.textContent = `
    .bid-view{font:13px/1.5 ui-sans-serif,system-ui,sans-serif;color:var(--fg);background:var(--bg);min-height:100%;padding:16px;box-sizing:border-box;overflow-wrap:anywhere}
    .bid-view *{box-sizing:border-box}.bid-view h2{font-size:15px;margin:0 0 4px;font-weight:600}.bid-view p{margin:0 0 12px}.bid-meta{font-size:12px;opacity:.65}
    .bid-actions{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}
    .bid-view button{font:inherit;border:1px solid color-mix(in srgb,var(--fg) 18%,transparent);border-radius:6px;background:transparent;color:inherit;padding:6px 10px;cursor:pointer}
    .bid-view button:hover:not(:disabled){background:color-mix(in srgb,var(--fg) 7%,transparent)}
    .bid-view button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .bid-view button:disabled{opacity:.4;cursor:default}
    .bid-view .primary{background:var(--fg);color:var(--bg);border-color:var(--fg)}
    .bid-notice{padding:10px 12px;border:1px solid color-mix(in srgb,var(--fg) 18%,transparent);border-radius:6px;font-size:12px;margin:12px 0}
    .bid-issue{padding:12px 0;border-top:1px solid color-mix(in srgb,var(--fg) 14%,transparent)}
    .bid-issue h3{font-size:13px;margin:0 0 4px}.bid-issue p{font-size:12px;margin:0 0 4px}
    .severity-critical{color:#d54b4b}.severity-warning{color:#c58b16}.severity-info{color:var(--accent)}
  `;
  const view = doc.createElement("section");
  view.className = "bid-view";
  view.style.setProperty("--bg", host.theme.background);
  view.style.setProperty("--fg", host.theme.foreground);
  view.style.setProperty("--accent", host.theme.accent);
  view.style.colorScheme = host.theme.mode;
  root.append(style, view);

  let active = true;
  let hydrated = false;

  const binding = host.services.open({
    services: [BidReview],
    assertAccess: () => host.signal.throwIfAborted(),
    onError: (error) => { renderError(error.message); },
  });
  const service = binding.use(BidReview);

  function renderError(message: string) {
    view.replaceChildren();
    const p = doc.createElement("p");
    p.textContent = message;
    p.className = "bid-notice";
    view.appendChild(p);
  }

  function render() {
    if (!active || host.signal.aborted) return;
    const state: BidReviewState | undefined = hydrated ? service.state.value : undefined;
    view.replaceChildren();

    // Header
    const h2 = doc.createElement("h2");
    h2.textContent = "标书审查";
    view.appendChild(h2);

    if (!state) {
      const p = doc.createElement("p");
      p.textContent = "正在连接 Pi 扩展…";
      p.className = "bid-meta";
      view.appendChild(p);
      return;
    }

    // File list
    if (state.loadedFiles.length > 0) {
      const meta = doc.createElement("p");
      meta.className = "bid-meta";
      meta.textContent = `已加载 ${state.loadedFiles.length} 份标书文件`;
      view.appendChild(meta);
    } else {
      const meta = doc.createElement("p");
      meta.textContent = "请加载招标文件（.docx 格式）开始审查";
      meta.className = "bid-meta";
      view.appendChild(meta);
    }

    // Actions
    const actions = doc.createElement("div");
    actions.className = "bid-actions";

    const loadBtn = doc.createElement("button");
    loadBtn.textContent = "加载标书";
    loadBtn.disabled = state.reviewStatus === "reviewing";
    loadBtn.addEventListener("click", () => {
      // TODO: use host file picker
      service.loadDocument({ filePath: "/path/to/bid.docx" }, BACKGROUND_CONTEXT);
    });
    actions.appendChild(loadBtn);

    const reviewBtn = doc.createElement("button");
    reviewBtn.textContent = state.reviewStatus === "reviewing" ? "审查中…" : "开始审查";
    reviewBtn.className = "primary";
    reviewBtn.disabled = state.loadedFiles.length === 0 || state.reviewStatus === "reviewing";
    reviewBtn.addEventListener("click", () => {
      const ids = state.loadedFiles.map((f) => f.id);
      service.startReview({ fileIds: ids }, BACKGROUND_CONTEXT);
    });
    actions.appendChild(reviewBtn);

    const exportBtn = doc.createElement("button");
    exportBtn.textContent = "导出报告";
    exportBtn.disabled = state.reviewStatus !== "done" || state.issues.length === 0;
    exportBtn.addEventListener("click", () => {
      service.exportReport({ format: "markdown" }, BACKGROUND_CONTEXT);
    });
    actions.appendChild(exportBtn);

    view.appendChild(actions);

    // Error display
    if (state.lastError) {
      const err = doc.createElement("p");
      err.textContent = state.lastError;
      err.className = "bid-notice";
      view.appendChild(err);
    }

    // Issues
    if (state.reviewStatus === "done" && state.issues.length > 0) {
      for (const issue of state.issues) {
        const div = doc.createElement("div");
        div.className = "bid-issue";

        const h3 = doc.createElement("h3");
        const severitySpan = doc.createElement("span");
        severitySpan.className = `severity-${issue.severity}`;
        severitySpan.textContent = `[${issue.severity}] `;
        h3.appendChild(severitySpan);
        h3.appendChild(doc.createTextNode(issue.title));
        div.appendChild(h3);

        if (issue.category) {
          const cat = doc.createElement("p");
          cat.className = "bid-meta";
          cat.textContent = issue.category;
          div.appendChild(cat);
        }

        const desc = doc.createElement("p");
        desc.textContent = issue.description;
        div.appendChild(desc);

        if (issue.suggestion) {
          const sug = doc.createElement("p");
          sug.className = "bid-meta";
          sug.textContent = `建议: ${issue.suggestion}`;
          div.appendChild(sug);
        }

        view.appendChild(div);
      }
    } else if (state.reviewStatus === "done") {
      const p = doc.createElement("p");
      p.textContent = "审查完成，未发现问题。";
      p.className = "bid-meta";
      view.appendChild(p);
    }
  }

  let unsubscribe = () => {};
  const abort = () => { active = false; };
  host.signal.addEventListener("abort", abort, { once: true });

  try {
    await binding.ready(BACKGROUND_CONTEXT);
    host.signal.throwIfAborted();
    hydrated = true;
    unsubscribe = service.state.subscribe(() => render());
    render();
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
