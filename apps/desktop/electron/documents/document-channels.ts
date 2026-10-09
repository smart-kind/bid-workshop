/** Shared between the main-process owner and the doc preload; no Electron imports. */
export const DOCUMENT_VIEW_SCHEME = "bid-docs";

export const DOCUMENT_IPC = {
  consumePendingOpen: "bid-docs:consume-pending-open",
  consumeNewBlank: "bid-docs:consume-new-blank",
  consumeAiDocContent: "bid-docs:consume-ai-doc-content",
  save: "bid-docs:save",
  saveAs: "bid-docs:save-as",
  saveNew: "bid-docs:save-new",
  saveTo: "bid-docs:save-to",
  writeRecovery: "bid-docs:write-recovery",
  recentFiles: "bid-docs:recent-files",
  exportHtml: "bid-docs:export-html",
  exportPdf: "bid-docs:export-pdf",
  openDocument: "bid-docs:open-document",
  aiGetSettings: "bid-docs:ai-get-settings",
  aiStream: "bid-docs:ai-stream",
  aiStreamCancel: "bid-docs:ai-stream-cancel",
} as const;

/** Pushed main → document view. Not invoke channels, so they carry no reply. */
export const DOCUMENT_PUSH = {
  menuCommand: "bid-docs:menu-command",
  closeCheck: "bid-docs:close-check",
  closeSaveRequest: "bid-docs:close-save-request",
  /** one model turn's chunk: delta / reasoning / tool-call / done / error / ping */
  aiStreamChunk: "bid-docs:ai-stream-chunk",
} as const;

/** Document view → main: the answers to the pushes above. */
export const DOCUMENT_REPORT = {
  closeCheck: "bid-docs:close-check-result",
  closeSaveResult: "bid-docs:close-save-result",
} as const;
