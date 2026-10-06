import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { DOCUMENT_IPC } from "../documents/document-channels";
import type { PendingDocument } from "../documents/document-view";

/**
 * What the document-view IPC layer needs from the view owner. Taking the two
 * operations instead of the owner keeps `DocumentViewOwner`'s per-window state
 * private.
 */
export interface DocumentViewIpcTarget {
  /** the one-shot open payload for a hosted view, null when nothing is pending */
  pendingDocumentForSender(senderId: number): Promise<PendingDocument | null>;
  /** whether `senderId` is a document view this owner created */
  hasSender(senderId: number): boolean;
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
