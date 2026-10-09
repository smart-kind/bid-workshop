import { ipcMain } from "electron";
import {
  readDocumentAiSettings,
  streamDocumentAiTurn,
  type DocumentAiChunk,
  type DocumentAiTurnRequest,
} from "@bid-workshop/document-ai";
import { DOCUMENT_IPC, DOCUMENT_PUSH } from "../documents/document-channels";
import { resolveAgentDir } from "../application/agent-dir";
import { assertDocumentSender, type DocumentViewIpcTarget } from "./document-view-ipc";

/**
 * The hosted document editor's AI panel.
 *
 * The editor runs in its own `WebContentsView`, so like the rest of the document
 * channels these answer only a webContents the view owner created
 * (`assertDocumentSender`); the panel reaches them through the document preload,
 * never through the app renderer.
 *
 * The panel talks to the model from here rather than from the renderer: the main
 * process holds the provider credentials and is not subject to CORS. The
 * provider configuration is pi's own, so the shell has one place to configure
 * models; `@bid-workshop/document-ai` does the reading and the streaming, and
 * this module is only the channel plumbing.
 *
 * One turn streams back as `DOCUMENT_PUSH.aiStreamChunk` messages keyed by
 * request id, and `ai-stream-cancel` aborts it.
 */
export function registerDocumentAiIpc(target: Pick<DocumentViewIpcTarget, "hasSender">): void {
  const active = new Map<string, AbortController>();

  ipcMain.handle(DOCUMENT_IPC.aiGetSettings, (event) => {
    assertDocumentSender(target, event, DOCUMENT_IPC.aiGetSettings);
    return readDocumentAiSettings(resolveAgentDir());
  });

  ipcMain.handle(DOCUMENT_IPC.aiStream, async (event, raw: unknown) => {
    assertDocumentSender(target, event, DOCUMENT_IPC.aiStream);
    const request = raw as Partial<DocumentAiTurnRequest> | null;
    // Without a request id there is nothing to key the chunks to. Throwing (rather
    // than returning) makes the renderer's start promise reject, so the panel
    // reports it instead of waiting out its silence watchdog.
    if (!request || typeof request.requestId !== "string" || request.requestId === "") {
      throw new Error("A model turn needs a request id.");
    }
    const send = (chunk: DocumentAiChunk): void => {
      if (!event.sender.isDestroyed()) event.sender.send(DOCUMENT_PUSH.aiStreamChunk, chunk);
    };
    const controller = new AbortController();
    active.set(request.requestId, controller);
    try {
      await streamDocumentAiTurn(request as DocumentAiTurnRequest, controller.signal, (chunk) =>
        send(chunk),
      );
    } finally {
      active.delete(request.requestId);
    }
  });

  ipcMain.handle(DOCUMENT_IPC.aiStreamCancel, (event, raw: unknown) => {
    assertDocumentSender(target, event, DOCUMENT_IPC.aiStreamCancel);
    if (typeof raw === "string") active.get(raw)?.abort();
  });
}
