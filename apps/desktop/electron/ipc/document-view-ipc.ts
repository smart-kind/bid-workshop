import {
  BrowserWindow,
  dialog,
  ipcMain,
  webContents,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { DOCUMENT_IPC, DOCUMENT_PUSH, DOCUMENT_REPORT } from "../documents/document-channels";
import type { PendingDocument } from "../documents/document-view";
import {
  fileExists,
  freeDocumentPath,
  messageOf,
  readRecentDocuments,
  recoveryCopyPath,
  rememberRecentDocument,
  saveDocumentAs,
  writeDocumentFile,
} from "../documents/document-io";

/**
 * What the document-view IPC layer needs from the view owner. Taking these
 * operations instead of the owner keeps `DocumentViewOwner`'s per-window state
 * private.
 */
export interface DocumentViewIpcTarget {
  /** the one-shot open payload for a hosted view, null when nothing is pending */
  pendingDocumentForSender(senderId: number): Promise<PendingDocument | null>;
  /** whether `senderId` is a document view this owner created */
  hasSender(senderId: number): boolean;
  /** the absolute path this view has open, null while it shows nothing */
  documentPathForSender(senderId: number): string | null;
  /** the view's document now lives at this path (first save, Save As, New) */
  noteSavedPath(senderId: number, absolutePath: string): void;
  /** File > Open: hands this view a document it asked for, or null when it may not have it */
  openDocumentForSender(senderId: number, absolutePath: string): Promise<PendingDocument | null>;
}

/** The part of the target the leave guard needs; the owner passes itself. */
export type DocumentViewLookup = Pick<DocumentViewIpcTarget, "hasSender" | "documentPathForSender">;

/**
 * `ipcMain` entry points for the hosted document editor.
 *
 * The editor runs in its own `WebContentsView`, so it is never the window's main
 * frame and cannot go through `mainFrameHandler` (which exists to reject
 * subframes of the app renderer). The equivalent guarantee here is the sender
 * check in `assertDocumentSender`: a channel only answers a webContents the view
 * owner created, so an extension iframe or a stray frame cannot reach it, and a
 * document channel is not callable before any document view exists.
 *
 * Writes go further: `save` only accepts the path that view actually has open,
 * so a renderer cannot ask main to overwrite an arbitrary file even though it is
 * the one producing the bytes.
 */
export function registerDocumentViewIpc(target: DocumentViewIpcTarget): void {
  ipcMain.handle(DOCUMENT_IPC.consumePendingOpen, (event) => {
    assertDocumentSender(target, event, DOCUMENT_IPC.consumePendingOpen);
    return target.pendingDocumentForSender(event.sender.id);
  });

  ipcMain.handle(DOCUMENT_IPC.consumeNewBlank, (event) => {
    assertDocumentSender(target, event, DOCUMENT_IPC.consumeNewBlank);
    // A view is never booted as a blank document here: New Document turns the view
    // the user is already looking at blank in place, so a boot always follows
    // either a handoff or nothing at all. This is the answer, not a stub.
    return false;
  });

  ipcMain.handle(DOCUMENT_IPC.consumeAiDocContent, (event) => {
    assertDocumentSender(target, event, DOCUMENT_IPC.consumeAiDocContent);
    return null;
  });

  ipcMain.handle(DOCUMENT_IPC.save, async (event, rawPath: unknown, rawBytes: unknown) => {
    assertDocumentSender(target, event, DOCUMENT_IPC.save);
    const requested = requireString(rawPath, "path");
    const openPath = target.documentPathForSender(event.sender.id);
    if (!openPath || openPath !== requested) {
      return { ok: false, error: "This view is not showing that document." };
    }
    try {
      await writeDocumentFile(openPath, requireBytes(rawBytes));
      await rememberRecentDocument(openPath);
      return { ok: true, path: openPath };
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  });

  ipcMain.handle(
    DOCUMENT_IPC.saveAs,
    async (event, rawName: unknown, rawBytes: unknown, rawSource: unknown) => {
      assertDocumentSender(target, event, DOCUMENT_IPC.saveAs);
      const defaultName = requireString(rawName, "defaultName");
      // `sourcePath` only names the dialog's starting folder; it is never the
      // destination, so a renderer cannot steer the write with it.
      const source = typeof rawSource === "string" && rawSource !== "" ? rawSource : undefined;
      const outcome = await saveDocumentAs(
        BrowserWindow.fromWebContents(event.sender) ?? undefined,
        source ? joinName(source, defaultName) : defaultName,
        requireBytes(rawBytes),
      );
      if (!outcome.ok) {
        return outcome.cancelled ? { ok: false } : { ok: false, error: outcome.error };
      }
      const saved = outcome.path ?? "";
      target.noteSavedPath(event.sender.id, saved);
      await rememberRecentDocument(saved);
      return { ok: true, path: saved };
    },
  );

  ipcMain.handle(DOCUMENT_IPC.saveNew, async (event, rawName: unknown, rawBytes: unknown) => {
    assertDocumentSender(target, event, DOCUMENT_IPC.saveNew);
    const defaultName = requireString(rawName, "defaultName");
    try {
      const destination = await freeDocumentPath(defaultName);
      await writeDocumentFile(destination, requireBytes(rawBytes));
      target.noteSavedPath(event.sender.id, destination);
      await rememberRecentDocument(destination);
      return { ok: true, path: destination };
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  });

  ipcMain.handle(
    DOCUMENT_IPC.saveTo,
    async (event, rawPath: unknown, rawBytes: unknown, rawOverwrite: unknown) => {
      assertDocumentSender(target, event, DOCUMENT_IPC.saveTo);
      const destination = requireString(rawPath, "path");
      if (rawOverwrite !== true && (await fileExists(destination))) {
        return { ok: false, error: `${destination} already exists.` };
      }
      try {
        await writeDocumentFile(destination, requireBytes(rawBytes));
        await rememberRecentDocument(destination);
        return { ok: true, path: destination };
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
    },
  );

  ipcMain.handle(DOCUMENT_IPC.writeRecovery, async (event, rawPath: unknown, rawBytes: unknown) => {
    assertDocumentSender(target, event, DOCUMENT_IPC.writeRecovery);
    try {
      await writeDocumentFile(
        recoveryCopyPath(requireString(rawPath, "path")),
        requireBytes(rawBytes),
      );
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle(DOCUMENT_IPC.recentFiles, (event) => {
    assertDocumentSender(target, event, DOCUMENT_IPC.recentFiles);
    return readRecentDocuments();
  });

  ipcMain.handle(
    DOCUMENT_IPC.exportHtml,
    async (event, rawName: unknown, rawHtml: unknown, rawOut: unknown) => {
      assertDocumentSender(target, event, DOCUMENT_IPC.exportHtml);
      const defaultName = withExtension(requireString(rawName, "defaultName"), "html");
      const html = requireString(rawHtml, "html");
      const destination =
        typeof rawOut === "string" && rawOut !== ""
          ? rawOut
          : await askSavePath(event.sender, defaultName);
      if (!destination) return { ok: false };
      try {
        await writeDocumentFile(destination, new TextEncoder().encode(html));
        return { ok: true, path: destination };
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
    },
  );

  ipcMain.handle(
    DOCUMENT_IPC.exportPdf,
    async (event, rawName: unknown, rawWidth: unknown, rawHeight: unknown, rawOut: unknown) => {
      assertDocumentSender(target, event, DOCUMENT_IPC.exportPdf);
      const defaultName = withExtension(requireString(rawName, "defaultName"), "pdf");
      const widthTwips = requirePositiveNumber(rawWidth, "pageWidthTwips");
      const heightTwips = requirePositiveNumber(rawHeight, "pageHeightTwips");
      const destination =
        typeof rawOut === "string" && rawOut !== ""
          ? rawOut
          : await askSavePath(event.sender, defaultName);
      if (!destination) return { ok: false };
      try {
        // The document renderer prints itself: it holds the paginated, laid-out
        // document, and Chromium is the only thing here that can produce a PDF.
        const pdf = await event.sender.printToPDF({
          pageSize: { width: widthTwips / 1440, height: heightTwips / 1440 },
          printBackground: true,
          margins: { marginType: "none" },
        });
        await writeDocumentFile(destination, pdf);
        return { ok: true, path: destination };
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
    },
  );

  ipcMain.handle(DOCUMENT_IPC.openDocument, async (event, rawPath: unknown) => {
    assertDocumentSender(target, event, DOCUMENT_IPC.openDocument);
    const chosen =
      typeof rawPath === "string" && rawPath !== "" ? rawPath : await askOpenPath(event.sender);
    if (!chosen) return null;
    try {
      if (!(await fileExists(chosen))) throw new Error(`${chosen} does not exist.`);
      // The guard inside runs first: the document already open gets its chance to
      // save before the renderer replaces it with the one asked for.
      const handed = await target.openDocumentForSender(event.sender.id, chosen);
      if (!handed)
        console.warn(`[documents] kept the open document: ${chosen} was not handed over`);
      return handed;
    } catch (error) {
      console.warn("[documents] open failed", messageOf(error));
      return null;
    }
  });

  // The leave guard's answers. There is no reply to send for an unknown sender,
  // so those are dropped rather than thrown.
  ipcMain.on(DOCUMENT_REPORT.closeCheck, (event, raw: unknown) => {
    settleLeave(target, event.sender.id, "check", dirtyFromReport(raw));
  });
  ipcMain.on(DOCUMENT_REPORT.closeSaveResult, (event, raw: unknown) => {
    settleLeave(target, event.sender.id, "save", raw === true);
  });
}

/**
 * Sends a menu command to the document view the user is looking at. Returns
 * false when no document view holds focus, so the caller can fall back.
 */
export function sendDocumentMenuCommand(
  target: Pick<DocumentViewIpcTarget, "hasSender">,
  command: string,
): boolean {
  const focused = webContents.getFocusedWebContents();
  if (!focused || !target.hasSender(focused.id)) return false;
  focused.send(DOCUMENT_PUSH.menuCommand, command);
  return true;
}

const CHECK_TIMEOUT_MS = 5_000;
const SAVE_TIMEOUT_MS = 60_000;

type LeaveStage = "check" | "save";

interface PendingLeave {
  readonly stage: LeaveStage;
  readonly finish: (value: boolean) => void;
}

const pendingLeaves = new Map<number, PendingLeave>();
const inFlightLeaves = new Map<number, Promise<boolean>>();

/**
 * Gives a document view the chance to save before it is hidden or reloaded.
 *
 * Both of those reload the renderer, which would otherwise drop edits that only
 * exist in memory — the pane reports its rectangle on every resize, so the guard
 * only runs when the document actually changes.
 *
 * Guards overlap in practice: the pane's effect cleans up and then re-runs on
 * every switch, and a resize re-reports the rectangle, so two can arrive in the
 * same tick. They all ask one question, so they share one answer. Running two
 * handshakes instead lets the second one release the first as "done", and the
 * view is then torn down (its open path cleared) while its save is still on the
 * way — which is exactly how a save came back refused with "not showing that
 * document".
 *
 * Returns false when the view was asked to save and did not manage it; the caller
 * then leaves the view alone rather than moving away from unsaved work.
 */
export function prepareDocumentForLeave(
  contents: WebContents,
  view: DocumentViewLookup,
  nextPath: string | null,
): Promise<boolean> {
  const senderId = contents.id;
  if (contents.isDestroyed() || contents.isCrashed()) return Promise.resolve(true);
  if (!view.hasSender(senderId)) return Promise.resolve(true);
  const openPath = view.documentPathForSender(senderId);
  if (!openPath || openPath === nextPath) return Promise.resolve(true);
  const running = inFlightLeaves.get(senderId);
  if (running) return running;
  const run = runLeaveGuard(contents, senderId);
  const tracked = run.finally(() => {
    if (inFlightLeaves.get(senderId) === tracked) inFlightLeaves.delete(senderId);
  });
  inFlightLeaves.set(senderId, tracked);
  return tracked;
}

async function runLeaveGuard(contents: WebContents, senderId: number): Promise<boolean> {
  const dirty = await askLeave(contents, senderId, "check");
  if (!dirty) return true;
  return await askLeave(contents, senderId, "save");
}

function askLeave(contents: WebContents, senderId: number, stage: LeaveStage): Promise<boolean> {
  const channel = stage === "check" ? DOCUMENT_PUSH.closeCheck : DOCUMENT_PUSH.closeSaveRequest;
  const timeoutMs = stage === "check" ? CHECK_TIMEOUT_MS : SAVE_TIMEOUT_MS;
  return new Promise<boolean>((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const record: PendingLeave = {
      stage,
      finish: (value) => {
        if (timer) clearTimeout(timer);
        contents.removeListener("destroyed", onGone);
        if (pendingLeaves.get(senderId) === record) pendingLeaves.delete(senderId);
        resolve(value);
      },
    };
    const onGone = (): void => record.finish(false);
    timer = setTimeout(() => {
      console.warn(
        stage === "check"
          ? "[documents] the renderer did not report whether it has unsaved work"
          : "[documents] the renderer did not report a save before leaving",
      );
      // An unanswered check counts as dirty: protecting work beats a reload that
      // silently discards it. An unanswered save cannot be assumed to have worked.
      record.finish(stage === "check");
    }, timeoutMs);
    pendingLeaves.set(senderId, record);
    contents.once("destroyed", onGone);
    contents.send(channel);
  });
}

function settleLeave(
  target: Pick<DocumentViewIpcTarget, "hasSender">,
  senderId: number,
  stage: LeaveStage,
  value: boolean,
): void {
  if (!target.hasSender(senderId)) return;
  const record = pendingLeaves.get(senderId);
  if (!record || record.stage !== stage) return;
  record.finish(value);
}

function dirtyFromReport(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null || !("dirty" in raw)) return true;
  return (raw as { dirty?: unknown }).dirty === true;
}

/** Asks for a document to open; null means the user cancelled. */
async function askOpenPath(contents: WebContents): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(contents) ?? undefined;
  const options: Electron.OpenDialogOptions = {
    properties: ["openFile"],
    filters: [{ name: "Word documents", extensions: ["docx"] }],
  };
  const picked = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  return picked.canceled ? null : (picked.filePaths[0] ?? null);
}

/** Asks where to write an export; null means the user cancelled. */
async function askSavePath(contents: WebContents, defaultName: string): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(contents) ?? undefined;
  const options: Electron.SaveDialogOptions = { defaultPath: defaultName };
  const picked = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);
  return picked.canceled || !picked.filePath ? null : picked.filePath;
}

/** The dialog's default name has to carry the extension it is exporting to. */
function withExtension(name: string, extension: string): string {
  return new RegExp(`\\.${extension}$`, "i").test(name) ? name : `${name}.${extension}`;
}

function requirePositiveNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return value;
}

function joinName(source: string, defaultName: string): string {
  const separator = Math.max(source.lastIndexOf("/"), source.lastIndexOf("\\"));
  return separator === -1 ? defaultName : `${source.slice(0, separator + 1)}${defaultName}`;
}

/**
 * The one guarantee every document channel shares: it answers only a
 * webContents the view owner created. Exported so the AI channels are held to
 * it too rather than growing a second copy.
 */
export function assertDocumentSender(
  target: Pick<DocumentViewIpcTarget, "hasSender">,
  event: IpcMainInvokeEvent,
  channel: string,
): void {
  if (!target.hasSender(event.sender.id)) {
    throw new Error(`${channel} must originate from a hosted document view.`);
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function requireBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error("document bytes must be binary data.");
}
