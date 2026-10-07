import { contextBridge, ipcRenderer } from "electron";
import { DOCUMENT_IPC, DOCUMENT_PUSH, DOCUMENT_REPORT } from "./documents/document-channels";

/**
 * `window.desktop` for the hosted document editor.
 *
 * Backed for real: the boot handoff (open, blank document), the whole save family
 * (save in place, Save As, first save, save to an explicit path, recovery copy),
 * the recent-documents list, comments and revisions through the document itself,
 * export to HTML and PDF, and the menu-command and close-check channels the
 * native File menu drives.
 *
 * What is not backed says so rather than looking like a cancelled dialog: every
 * member whose contract carries an `error` field returns one. The rest are
 * members whose only "no" is `null` (a cancelled picker) or `{ ok: false }` with
 * no field to explain itself, and they are listed with their reasons in
 * docs/shell-plan.md §七.
 */
const noop = (): void => {};
const unsubscribe = (): (() => void) => noop;

/** For members whose contract has an error field: a refusal, not a cancellation. */
const unsupported = (what: string): { ok: false; error: string } => ({
  ok: false,
  error: `${what} is not available in this host.`,
});

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
  // A cancelled file picker is the only "no" these two can report (see §七).
  openDocx: () => ipcRenderer.invoke(DOCUMENT_IPC.openDocument, null),
  openDocxPath: (path: string) => ipcRenderer.invoke(DOCUMENT_IPC.openDocument, path),
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
  createDocument: () => Promise.resolve(unsupported("Creating a document from the editor")),
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
  print: () => Promise.resolve(unsupported("Printing")),
  exportPdf: (
    defaultName: string,
    pageWidthTwips: number,
    pageHeightTwips: number,
    outPath?: string,
  ) =>
    ipcRenderer.invoke(
      DOCUMENT_IPC.exportPdf,
      defaultName,
      pageWidthTwips,
      pageHeightTwips,
      outPath ?? null,
    ),
  exportHtml: (defaultName: string, html: string, outPath?: string) =>
    ipcRenderer.invoke(DOCUMENT_IPC.exportHtml, defaultName, html, outPath ?? null),
  printPdfBuffer: () => Promise.resolve(unsupported("Chunked PDF printing")),
  saveMergedPdf: () => Promise.resolve(unsupported("Merging PDF parts")),
  pickExportImagesTarget: () => Promise.resolve(null),
  takeExportPdf: () => Promise.resolve(unsupported("Exporting images")),
  writeExportImage: () => Promise.resolve(unsupported("Exporting images")),
  saveImageAs: () => Promise.resolve(unsupported("Saving a picture")),
  onViewImage: unsubscribe,
  aiChat: () => Promise.resolve(unsupported("The editor's own chat")),
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
  onCloseCheck: (handler: () => void) => subscribeArgs<[]>(DOCUMENT_PUSH.closeCheck, handler),
  reportCloseCheck: (state: unknown) => ipcRenderer.send(DOCUMENT_REPORT.closeCheck, state),
  onCloseSaveRequest: (handler: () => void) =>
    subscribeArgs<[]>(DOCUMENT_PUSH.closeSaveRequest, handler),
  reportCloseSaveResult: (ok: boolean) =>
    ipcRenderer.send(DOCUMENT_REPORT.closeSaveResult, ok === true),
  reportViewMenuState: noop,
};

contextBridge.exposeInMainWorld("desktop", desktop);
