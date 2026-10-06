import { BrowserWindow, ipcMain, webContents, type IpcMainInvokeEvent } from "electron";
import { DOCUMENT_IPC, DOCUMENT_PUSH } from "../documents/document-channels";
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
}

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

function joinName(source: string, defaultName: string): string {
  const separator = Math.max(source.lastIndexOf("/"), source.lastIndexOf("\\"));
  return separator === -1 ? defaultName : `${source.slice(0, separator + 1)}${defaultName}`;
}

function assertDocumentSender(
  target: DocumentViewIpcTarget,
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
