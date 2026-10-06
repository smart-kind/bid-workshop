import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { DesktopViewContext } from "@bid-workshop/extension-ui/browser";
import { BidReview, type BidReviewState, type BidIssue } from "./contract";

export async function mount(
  root: HTMLElement,
  host: DesktopViewContext,
): Promise<() => Promise<void>> {
  const doc = root.ownerDocument;
  const style = doc.createElement("style");
  style.textContent = `
    .bid-view{font:13px/1.5 ui-sans-serif,system-ui,sans-serif;color:var(--fg);background:var(--bg);min-height:100%;padding:16px;box-sizing:border-box;overflow-wrap:anywhere}
    .bid-view *{box-sizing:border-box}
    .bid-view h2{font-size:15px;margin:0 0 4px;font-weight:600}
    .bid-view p{margin:0 0 12px}
    .bid-meta{font-size:12px;opacity:.65}
    .bid-outline{margin:0 0 12px;padding-left:18px;font-size:12px;opacity:.75;line-height:1.7}
    .bid-outline li{margin:0}
    .bid-actions{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}
    .bid-view button{font:inherit;border:1px solid color-mix(in srgb,var(--fg) 18%,transparent);border-radius:6px;background:transparent;color:inherit;padding:6px 10px;cursor:pointer}
    .bid-view button:hover:not(:disabled){background:color-mix(in srgb,var(--fg) 7%,transparent)}
    .bid-view button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .bid-view button:disabled{opacity:.4;cursor:default}
    .bid-view .primary{background:var(--fg);color:var(--bg);border-color:var(--fg)}
    .bid-notice{padding:10px 12px;border:1px solid color-mix(in srgb,var(--fg) 18%,transparent);border-radius:6px;font-size:12px;margin:12px 0}
    .bid-progress{margin:16px 0}
    .bid-progress-bar{height:6px;background:color-mix(in srgb,var(--fg) 10%,transparent);border-radius:3px;overflow:hidden}
    .bid-progress-fill{height:100%;background:var(--accent);border-radius:3px;transition:width .3s ease}
    .bid-progress-text{font-size:11px;opacity:.6;margin-top:4px}
    .bid-summary{padding:12px;border:1px solid color-mix(in srgb,var(--fg) 14%,transparent);border-radius:8px;margin:12px 0;font-size:12px;white-space:pre-wrap;line-height:1.6;background:color-mix(in srgb,var(--fg) 2%,transparent)}
    .bid-stats{display:flex;gap:12px;margin:12px 0}
    .bid-stat{padding:8px 12px;border-radius:6px;font-size:12px;font-weight:500}
    .bid-stat.critical{background:rgba(213,75,75,.12);color:#d54b4b}
    .bid-stat.warning{background:rgba(197,139,22,.12);color:#c58b16}
    .bid-stat.info{background:rgba(80,140,220,.12);color:#508cdc}
    .bid-filters{display:flex;gap:6px;margin:12px 0;flex-wrap:wrap}
    .bid-filter{font-size:11px;padding:3px 8px;border-radius:4px;cursor:pointer;border:1px solid color-mix(in srgb,var(--fg) 15%,transparent);background:transparent;color:inherit;opacity:.7}
    .bid-filter:hover{opacity:1}
    .bid-filter.active{background:var(--fg);color:var(--bg);opacity:1;border-color:var(--fg)}
    .bid-issue{padding:12px 0;border-top:1px solid color-mix(in srgb,var(--fg) 14%,transparent)}
    .bid-issue h3{font-size:13px;margin:0 0 4px}
    .bid-issue p{font-size:12px;margin:0 0 4px}
    .bid-issue .bid-location{font-size:11px;opacity:.55;margin-top:4px}
    .severity-critical{color:#d54b4b}
    .severity-warning{color:#c58b16}
    .severity-info{color:#508cdc}
    .bid-badge{display:inline-block;font-size:10px;padding:1px 6px;border-radius:3px;margin-right:4px;font-weight:500}
    .bid-badge.critical{background:rgba(213,75,75,.15);color:#d54b4b}
    .bid-badge.warning{background:rgba(197,139,22,.15);color:#c58b16}
    .bid-badge.info{background:rgba(80,140,220,.15);color:#508cdc}
    .bid-category{font-size:11px;opacity:.6;margin-left:6px}
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
  let severityFilter: string | null = null;
  let categoryFilter: string | null = null;
  /** Outcome of the last write-comments run, shown under the actions. */
  let commentResult: string | null = null;

  const SAMPLE_FILES = [
    { name: "投标文件-某软件科技.docx", label: "投标文件 — 某软件科技有限公司" },
  ];

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

  function loadSampleFile(filename: string) {
    // The frame URL carries no query, and the frame is served without an import
    // map, so the panel cannot learn the workspace path here. It sends the bare
    // name and the backend resolves it against the session workspace.
    service.loadDocument({ filePath: filename }, BACKGROUND_CONTEXT);
  }

  function render() {
    if (!active || host.signal.aborted) return;
    const state: BidReviewState | undefined = hydrated ? service.state.value : undefined;
    view.replaceChildren();

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

    // File loading section
    if (state.loadedFiles.length === 0) {
      const meta = doc.createElement("p");
      meta.textContent = "加载样例文件开始审查演示";
      meta.className = "bid-meta";
      view.appendChild(meta);

      const actions = doc.createElement("div");
      actions.className = "bid-actions";

      for (const f of SAMPLE_FILES) {
        const btn = doc.createElement("button");
        btn.textContent = f.label;
        btn.addEventListener("click", () => loadSampleFile(f.name));
        actions.appendChild(btn);
      }

      const allBtn = doc.createElement("button");
      allBtn.textContent = "加载全部";
      allBtn.className = "primary";
      allBtn.addEventListener("click", () => {
        for (const f of SAMPLE_FILES) loadSampleFile(f.name);
      });
      actions.appendChild(allBtn);

      view.appendChild(actions);
      return;
    }

    // File list. What was parsed is shown, not just the file names, so the
    // document actually being read is visible rather than assumed.
    const meta = doc.createElement("p");
    meta.className = "bid-meta";
    meta.textContent = `已加载 ${state.loadedFiles.length} 份文件：${state.loadedFiles.map((f) => f.name).join("、")}`;
    view.appendChild(meta);

    for (const file of state.loadedFiles) {
      const summary = doc.createElement("p");
      summary.className = "bid-meta";
      summary.dataset.file = file.name;
      summary.textContent = `${file.name}：${file.blockCount} 个块，${file.tableCount} 张表，${file.sections.length} 个标题`;
      view.appendChild(summary);

      if (file.sections.length > 0) {
        const outline = doc.createElement("ul");
        outline.className = "bid-outline";
        outline.dataset.outline = file.name;
        for (const title of file.sections) {
          const item = doc.createElement("li");
          item.textContent = title;
          outline.appendChild(item);
        }
        view.appendChild(outline);
      }
    }

    // Actions
    const actions = doc.createElement("div");
    actions.className = "bid-actions";

    const loadMoreBtn = doc.createElement("button");
    loadMoreBtn.textContent = "加载标书";
    loadMoreBtn.disabled = state.reviewStatus === "reviewing";
    loadMoreBtn.addEventListener("click", () => {
      const remaining = SAMPLE_FILES.filter(
        (f) => !state.loadedFiles.some((lf) => lf.name === f.name),
      );
      if (remaining.length > 0) loadSampleFile(remaining[0].name);
    });
    actions.appendChild(loadMoreBtn);

    const reviewBtn = doc.createElement("button");
    reviewBtn.textContent = state.reviewStatus === "reviewing" ? "审查中…" : "开始审查";
    reviewBtn.className = "primary";
    reviewBtn.disabled = state.loadedFiles.length === 0 || state.reviewStatus === "reviewing";
    reviewBtn.addEventListener("click", () => {
      const ids = state.loadedFiles.map((f) => f.id);
      service.startReview({ fileIds: ids }, BACKGROUND_CONTEXT);
    });
    actions.appendChild(reviewBtn);

    if (state.issues.length > 0) {
      const commentBtn = doc.createElement("button");
      commentBtn.textContent = "写入批注";
      commentBtn.addEventListener("click", () => {
        const target = state.loadedFiles[state.loadedFiles.length - 1];
        if (!target) return;
        commentBtn.disabled = true;
        service.writeComments({ fileId: target.id }, BACKGROUND_CONTEXT).then(
          (result) => {
            commentResult = `已写入 ${result.written} 条批注：${result.outputPath}${
              result.skipped.length > 0 ? `（${result.skipped.length} 条因缺定位未写入）` : ""
            }`;
            render();
          },
          (error: Error) => {
            commentResult = `写入批注失败：${error.message}`;
            render();
          },
        );
      });
      actions.appendChild(commentBtn);
    }

    if (state.reviewStatus === "reviewing") {
      const cancelBtn = doc.createElement("button");
      cancelBtn.textContent = "取消";
      cancelBtn.addEventListener("click", () => service.cancelReview({}, BACKGROUND_CONTEXT));
      actions.appendChild(cancelBtn);
    }

    const exportBtn = doc.createElement("button");
    exportBtn.textContent = "导出报告";
    exportBtn.disabled = state.reviewStatus !== "done" || state.issues.length === 0;
    exportBtn.addEventListener("click", () => {
      service.exportReport({ format: "markdown" }, BACKGROUND_CONTEXT);
    });
    actions.appendChild(exportBtn);

    view.appendChild(actions);

    if (commentResult) {
      const note = doc.createElement("p");
      note.className = "bid-notice";
      note.dataset.commentResult = "1";
      note.textContent = commentResult;
      view.appendChild(note);
    }

    // Progress
    if (state.reviewStatus === "reviewing") {
      const progressDiv = doc.createElement("div");
      progressDiv.className = "bid-progress";
      const bar = doc.createElement("div");
      bar.className = "bid-progress-bar";
      const fill = doc.createElement("div");
      fill.className = "bid-progress-fill";
      fill.style.width = `${state.progress}%`;
      bar.appendChild(fill);
      const text = doc.createElement("div");
      text.className = "bid-progress-text";
      text.textContent = `审查进度：${state.progress}%`;
      progressDiv.append(bar, text);
      view.appendChild(progressDiv);
    }

    // Error
    if (state.lastError) {
      const err = doc.createElement("p");
      err.textContent = state.lastError;
      err.className = "bid-notice";
      view.appendChild(err);
    }

    // Summary + stats
    if (state.reviewStatus === "done" && state.issues.length > 0) {
      if (state.summary) {
        const summaryDiv = doc.createElement("div");
        summaryDiv.className = "bid-summary";
        summaryDiv.textContent = state.summary;
        view.appendChild(summaryDiv);
      }

      // Stats by severity
      const stats = doc.createElement("div");
      stats.className = "bid-stats";
      const counts = { critical: 0, warning: 0, info: 0 };
      for (const issue of state.issues) counts[issue.severity]++;

      for (const [sev, count] of Object.entries(counts)) {
        const stat = doc.createElement("div");
        stat.className = `bid-stat ${sev}`;
        const labels: Record<string, string> = { critical: "严重", warning: "警告", info: "提示" };
        stat.textContent = `${labels[sev]}: ${count}`;
        stats.appendChild(stat);
      }
      view.appendChild(stats);

      // Category stats
      const catCounts: Record<string, number> = {};
      for (const issue of state.issues) {
        const cat = issue.category || "other";
        catCounts[cat] = (catCounts[cat] || 0) + 1;
      }
      const catLabels: Record<string, string> = {
        qualification: "资质",
        pricing: "报价",
        technical: "技术",
        legal: "法律条款",
        format: "格式",
      };

      // Filters
      const filters = doc.createElement("div");
      filters.className = "bid-filters";

      const allFilter = doc.createElement("button");
      allFilter.className = `bid-filter ${!severityFilter ? "active" : ""}`;
      allFilter.textContent = "全部";
      allFilter.addEventListener("click", () => {
        severityFilter = null;
        categoryFilter = null;
        render();
      });
      filters.appendChild(allFilter);

      const severityOrder = ["critical", "warning", "info"] as const;
      for (const sev of severityOrder) {
        const btn = doc.createElement("button");
        const labels: Record<string, string> = { critical: "严重", warning: "警告", info: "提示" };
        btn.className = `bid-filter ${severityFilter === sev ? "active" : ""}`;
        btn.textContent = `${labels[sev]} (${counts[sev]})`;
        btn.addEventListener("click", () => {
          severityFilter = severityFilter === sev ? null : sev;
          categoryFilter = null;
          render();
        });
        filters.appendChild(btn);
      }

      for (const [cat, count] of Object.entries(catCounts)) {
        const btn = doc.createElement("button");
        btn.className = `bid-filter ${categoryFilter === cat ? "active" : ""}`;
        btn.textContent = `${catLabels[cat] || cat} (${count})`;
        btn.addEventListener("click", () => {
          categoryFilter = categoryFilter === cat ? null : cat;
          severityFilter = null;
          render();
        });
        filters.appendChild(btn);
      }

      view.appendChild(filters);

      // Filtered issues
      let filtered = state.issues;
      if (severityFilter) filtered = filtered.filter((i) => i.severity === severityFilter);
      if (categoryFilter) filtered = filtered.filter((i) => i.category === categoryFilter);

      for (const issue of filtered) {
        view.appendChild(renderIssue(issue));
      }
    } else if (state.reviewStatus === "done") {
      const p = doc.createElement("p");
      p.textContent = "审查完成，未发现问题。";
      p.className = "bid-meta";
      view.appendChild(p);
    }
  }

  function renderIssue(issue: BidIssue): HTMLElement {
    const div = doc.createElement("div");
    div.className = "bid-issue";

    const h3 = doc.createElement("h3");
    const badge = doc.createElement("span");
    badge.className = `bid-badge ${issue.severity}`;
    const sevLabels: Record<string, string> = { critical: "严重", warning: "警告", info: "提示" };
    badge.textContent = sevLabels[issue.severity] || issue.severity;
    h3.appendChild(badge);

    const catLabels: Record<string, string> = {
      qualification: "资质",
      pricing: "报价",
      technical: "技术",
      legal: "法律条款",
      format: "格式",
    };
    if (issue.category) {
      const cat = doc.createElement("span");
      cat.className = "bid-category";
      cat.textContent = catLabels[issue.category] || issue.category;
      h3.appendChild(cat);
    }

    h3.appendChild(doc.createTextNode(" " + issue.title));
    div.appendChild(h3);

    const desc = doc.createElement("p");
    desc.textContent = issue.description;
    div.appendChild(desc);

    if (issue.suggestion) {
      const sug = doc.createElement("p");
      sug.className = "bid-meta";
      sug.textContent = `💡 ${issue.suggestion}`;
      div.appendChild(sug);
    }

    if (issue.location) {
      const loc = doc.createElement("div");
      loc.className = "bid-location";
      const parts: string[] = [];
      if (issue.location.section) parts.push(issue.location.section);
      if (issue.location.page) parts.push(`p.${issue.location.page}`);
      if (parts.length > 0) loc.textContent = `📍 ${parts.join(" · ")}`;
      div.appendChild(loc);
    }

    return div;
  }

  let unsubscribe = () => {};
  const abort = () => {
    active = false;
  };
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
