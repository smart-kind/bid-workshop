import { contextBridge, ipcRenderer } from "electron";
import { DOCUMENT_IPC, DOCUMENT_PUSH } from "./documents/document-channels";

/**
 * `window.desktop` for the hosted document editor.
 *
 * Backed for real: the boot consumes (open handoff, blank document, AI content),
 * the whole save family (save in place, Save As, first save, save to an explicit
 * path, crash-recovery copy), the recent-documents list, and the menu-command
 * channel the native File > Save / Save As items drive.
 *
 * Still inert, each for a reason recorded in docs/shell-plan.md §七: print and
 * export, images and the clipboard, the editor's own AI panel, Zotero, MCP, and
 * password-protected documents.
 */
const noop = (): void => {};
const unsubscribe = (): (() => void) => noop;

function subscribeArgs<Args extends readonly unknown[]>(
  channel: string,
  handler: (...args: Args) => void,
): () => void {
  const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => {
    handler(...(args as unknown as Args));
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const desktop = {
  getLanguage: () => Promise.resolve("zh"),
  onLanguageChanged: unsubscribe,
  getTheme: () => Promise.resolve("system"),
  onThemeChanged: unsubscribe,
  getAutoSaveDefault: () => Promise.resolve({ on: false, updatedAt: 0 }),
  onAutoSaveDefaultChanged: unsubscribe,
  setAiPanelPrefs: (patch: unknown) => Promise.resolve(patch),
  onChromePressed: unsubscribe,
  zoteroCommand: () => Promise.resolve({ ok: false, errorCode: "unsupported-command" }),
  onZoteroRequest: unsubscribe,
  respondToZotero: noop,
  openDocx: () => Promise.resolve(null),
  openDocxPath: () => Promise.resolve(null),
  openDocxDecrypt: () => Promise.resolve({ ok: false, reason: "unsupported" }),
  convertAltChunkHtml: () => Promise.resolve(null),
  setDocPassword: () => Promise.resolve({ ok: false }),
  docPasswordIntentRevision: () => Promise.resolve(0),
  discardDocPasswordIntents: () => Promise.resolve({ ok: false }),
  consumePendingOpenDocx: () => ipcRenderer.invoke(DOCUMENT_IPC.consumePendingOpen),
  consumeNewBlankDoc: () => Promise.resolve(false),
  consumeAiDocContent: () => Promise.resolve(null),
  consumeHeadlessExport: () => Promise.resolve(null),
  headlessExportDone: noop,
  createDocument: () => Promise.resolve({ ok: false }),
  onOpenDocx: unsubscribe,
  onRenamedDocx: unsubscribe,
  saveDocx: (path: string, data: ArrayBuffer, auto?: boolean) =>
    ipcRenderer.invoke(DOCUMENT_IPC.save, path, data, auto === true),
  writeRecoveryCopy: (path: string, data: ArrayBuffer) =>
    ipcRenderer.invoke(DOCUMENT_IPC.writeRecovery, path, data),
  onTeardown: unsubscribe,
  respellKick: () => Promise.resolve(),
  spellDiag: noop,
  saveDocxAs: (defaultName: string, data: ArrayBuffer, sourcePath?: string | null) =>
    ipcRenderer.invoke(DOCUMENT_IPC.saveAs, defaultName, data, sourcePath ?? null),
  saveDocxNew: (defaultName: string, data: ArrayBuffer) =>
    ipcRenderer.invoke(DOCUMENT_IPC.saveNew, defaultName, data),
  saveDocxTo: (path: string, data: ArrayBuffer, overwrite: boolean) =>
    ipcRenderer.invoke(DOCUMENT_IPC.saveTo, path, data, overwrite === true),
  getRecentFiles: () => ipcRenderer.invoke(DOCUMENT_IPC.recentFiles),
  pickImage: () => Promise.resolve(null),
  fontMetrics: () => Promise.resolve(null),
  getAiSettings: () => Promise.resolve({ provider: "anthropic", providers: {} }),
  setAiSettings: noop,
  print: () => Promise.resolve({ ok: false }),
  exportPdf: () => Promise.resolve({ ok: false }),
  exportHtml: () => Promise.resolve({ ok: false }),
  printPdfBuffer: () => Promise.resolve({ ok: false }),
  saveMergedPdf: () => Promise.resolve({ ok: false }),
  pickExportImagesTarget: () => Promise.resolve(null),
  takeExportPdf: () => Promise.resolve({ ok: false }),
  writeExportImage: () => Promise.resolve({ ok: false }),
  saveImageAs: () => Promise.resolve({ ok: false }),
  onViewImage: unsubscribe,
  aiChat: () => Promise.resolve({ ok: false }),
  aiStream: noop,
  aiStreamCancel: noop,
  aiGskStatus: () => Promise.resolve({ loggedIn: false }),
  aiGskLogin: noop,
  webSearch: () => Promise.resolve({ results: [], method: "error", error: "unavailable" }),
  imageSearch: () => Promise.resolve({ images: [], method: "error", error: "unavailable" }),
  analyzeMedia: () => Promise.resolve({ error: "unavailable" }),
  fetchImage: () => Promise.resolve(null),
  aiGenerateImage: () => Promise.resolve({ error: "unavailable" }),
  pickAttachments: () => Promise.resolve(null),
  addAttachmentPaths: () => Promise.resolve({ accepted: [], rejected: [] }),
  addPastedImage: () => Promise.resolve({ accepted: [], rejected: [] }),
  copyImageToClipboard: () => Promise.resolve(false),
  readAttachment: () => Promise.resolve({ ok: false }),
  readAttachmentImage: () => Promise.resolve({ ok: false }),
  getPathForFile: () => "",
  openNewTab: noop,
  listDocsTabs: () => Promise.resolve([]),
  focusDocsTab: noop,
  onAiStream: unsubscribe,
  onMenuCommand: (handler: (command: string, payload?: string) => void) =>
    subscribeArgs<[string, string?]>(DOCUMENT_PUSH.menuCommand, handler),
  onCloseCheck: unsubscribe,
  reportCloseCheck: noop,
  onCloseSaveRequest: unsubscribe,
  reportCloseSaveResult: noop,
  reportViewMenuState: noop,
};

contextBridge.exposeInMainWorld("desktop", desktop);
