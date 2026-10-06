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
} as const;

/** Pushed main → document view. Not invoke channels, so they carry no reply. */
export const DOCUMENT_PUSH = {
  menuCommand: "bid-docs:menu-command",
} as const;
