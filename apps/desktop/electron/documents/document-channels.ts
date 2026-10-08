/** Shared between the main-process owner and the doc preload; no Electron imports. */
export const DOCUMENT_VIEW_SCHEME = "bid-docs";

export const DOCUMENT_IPC = {
  consumePendingOpen: "bid-docs:consume-pending-open",
  consumeNewBlank: "bid-docs:consume-new-blank",
  consumeAiDocContent: "bid-docs:consume-ai-doc-content",
  reportViewMenuState: "bid-docs:report-view-menu-state",
  aiPanelDefault: "bid-docs:ai-panel-default",
} as const;
