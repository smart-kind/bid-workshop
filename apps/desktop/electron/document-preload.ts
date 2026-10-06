import { contextBridge, ipcRenderer } from "electron";
import { DOCUMENT_IPC } from "./documents/document-channels";

/**
 * `window.desktop` for the hosted document editor.
 *
 * The real editor expects the full GenOffice shell bridge, and its mount path
 * touches several members with no optional chaining (`LocaleProvider`'s
 * `onLanguageChanged`, the bootstrap's `getLanguage`/`getTheme`, the App
 * effects' `getRecentFiles`/`getAiSettings`/`onRenamedDocx`/`onOpenDocx`/
 * `onZoteroRequest`, and the three boot consumes). Those are backed here: the
 * consumes read the real pending document from main, everything else reports
 * empty defaults.
 *
 * The rest of the documented surface is stubbed so no code path can throw a
 * missing-member TypeError. Save, print, export, AI, Zotero, MCP and recovery
 * features are inert until they get a real host.
 */
const noop = (): void => {};
const unsubscribe = (): (() => void) => noop;

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
  saveDocx: () => Promise.resolve({ ok: false }),
  writeRecoveryCopy: () => Promise.resolve({ ok: false }),
  onTeardown: unsubscribe,
  respellKick: () => Promise.resolve(),
  spellDiag: noop,
  saveDocxAs: () => Promise.resolve({ ok: false }),
  saveDocxNew: () => Promise.resolve({ ok: false }),
  saveDocxTo: () => Promise.resolve({ ok: false }),
  getRecentFiles: () => Promise.resolve([]),
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
  onMenuCommand: unsubscribe,
  onCloseCheck: unsubscribe,
  reportCloseCheck: noop,
  onCloseSaveRequest: unsubscribe,
  reportCloseSaveResult: noop,
  reportViewMenuState: noop,
};

contextBridge.exposeInMainWorld("desktop", desktop);
