import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { ipcMain, protocol, WebContentsView, type BrowserWindow } from "electron";
import { DOCUMENT_IPC, DOCUMENT_VIEW_SCHEME } from "./document-channels";

/**
 * The document editor (`packages/document-editor`) is a standalone static
 * renderer that talks to a `window.desktop` preload bridge. We host it in a
 * `WebContentsView` over the Files pane, served from a dedicated privileged
 * scheme so its module scripts and parse worker load (a `file://` origin
 * cannot).
 *
 * Milestone: open one `.docx` and display it. Editing/saving are out of scope,
 * so the bridge stubs every mutating member the renderer might reach for on
 * mount, and only the read path (`consume-pending-open` + the handoff bytes)
 * is backed by real file access.
 */
export { DOCUMENT_IPC, DOCUMENT_VIEW_SCHEME } from "./document-channels";

/** The pane rectangle the host app renderer reports, in CSS pixels from the window's top-left. */
export interface DocumentViewRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ShowDocumentInput {
  /** absolute, already workspace-validated path of the `.docx` to open */
  readonly absolutePath: string;
  readonly rect: DocumentViewRect;
}

export interface DocumentViewOwnerOptions {
  /** directory holding the built `index.html` + `assets/**` */
  readonly distRoot: string;
  /** absolute path of the built `document-preload.js` */
  readonly preloadPath: string;
  /** Keep the renderer live while its window is hidden (tests run background windows). */
  readonly backgroundThrottling?: boolean;
  readonly onDiagnostic?: (message: string) => void;
}

interface Handoff {
  readonly absolutePath: string;
}

interface Pending {
  readonly path: string;
  readonly name: string;
  readonly token: string;
}

interface Entry {
  readonly view: WebContentsView;
  /** the document currently shown, null while hidden */
  currentPath: string | null;
  /** what the next `consume-pending-open` from this view returns */
  pending: Pending | null;
}

/** A docx file's identity, as the renderer's OpenFileResult expects it. */
export interface PendingDocument {
  readonly path: string;
  readonly name: string;
  readonly dataUrl: string;
  readonly hash: string;
}

const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export class DocumentViewOwner {
  private readonly entries = new Map<number, Entry>();
  private readonly handoffs = new Map<string, Handoff>();
  private readonly distRoot: string;
  private readonly preloadPath: string;
  private readonly backgroundThrottling: boolean;
  private readonly onDiagnostic: (message: string) => void;

  constructor(options: DocumentViewOwnerOptions) {
    this.distRoot = options.distRoot;
    this.preloadPath = options.preloadPath;
    this.backgroundThrottling = options.backgroundThrottling ?? true;
    this.onDiagnostic = options.onDiagnostic ?? (() => {});
  }

  /** Register the doc preload's boot IPC. Called once before any view is created. */
  installIpc(): void {
    ipcMain.handle(DOCUMENT_IPC.consumePendingOpen, (event) =>
      this.pendingDocument(event.sender.id),
    );
    ipcMain.handle(DOCUMENT_IPC.consumeNewBlank, () => false);
    ipcMain.handle(DOCUMENT_IPC.consumeAiDocContent, () => null);
  }

  /** Show `input.absolutePath` in `window`'s document view at `input.rect`, creating the view on first use. */
  show(window: BrowserWindow, input: ShowDocumentInput): void {
    if (window.isDestroyed()) return;
    const entry = this.entryFor(window);
    if (entry.currentPath === input.absolutePath && entry.pending) {
      entry.view.setBounds(rectToBounds(input.rect));
      entry.view.setVisible(true);
      return;
    }
    if (entry.pending) this.handoffs.delete(entry.pending.token);
    const token = randomUUID();
    this.handoffs.set(token, { absolutePath: input.absolutePath });
    entry.pending = {
      path: input.absolutePath,
      name: path.basename(input.absolutePath),
      token,
    };
    entry.currentPath = input.absolutePath;
    entry.view.setBounds(rectToBounds(input.rect));
    entry.view.setVisible(true);
    if (entry.view.webContents.getURL()) {
      // A live view can only consume the pending document at boot. Reload so
      // the boot path runs again and picks up the new handoff token.
      entry.view.webContents.reload();
    } else {
      void entry.view.webContents
        .loadURL(`${DOCUMENT_VIEW_SCHEME}://app/index.html`)
        .catch((error: unknown) =>
          this.onDiagnostic(`load document view failed: ${stringify(error)}`),
        );
    }
  }

  /** Hide the view when the pane goes away or a non-document file is selected. */
  hide(window: BrowserWindow): void {
    const entry = this.entries.get(window.id);
    if (!entry || window.isDestroyed()) return;
    if (entry.pending) this.handoffs.delete(entry.pending.token);
    entry.pending = null;
    entry.currentPath = null;
    entry.view.setVisible(false);
    // `View` exposes no visibility getter; zeroing the bounds makes "hidden"
    // observable (and a zero-sized view paints nothing even if still attached).
    entry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }

  /** Detach the view without closing its webContents (closing can wedge the UI thread). */
  destroy(window: BrowserWindow): void {
    const entry = this.entries.get(window.id);
    if (!entry) return;
    this.entries.delete(window.id);
    try {
      window.contentView.removeChildView(entry.view);
    } catch (error: unknown) {
      this.onDiagnostic(`detach document view failed: ${stringify(error)}`);
    }
  }

  /** The doc preload's one-shot open result for the view identified by `senderId`. */
  private async pendingDocument(senderId: number): Promise<PendingDocument | null> {
    const pending = this.entryForSender(senderId)?.pending;
    if (!pending) return null;
    return {
      path: pending.path,
      name: pending.name,
      dataUrl: `${DOCUMENT_VIEW_SCHEME}://app/_handoff/${pending.token}`,
      hash: await this.hashOf(pending.path),
    };
  }

  private entryForSender(senderId: number): Entry | undefined {
    for (const entry of this.entries.values()) {
      if (entry.view.webContents.id === senderId) return entry;
    }
    return undefined;
  }

  private async hashOf(absolutePath: string): Promise<string> {
    try {
      return createHash("sha256")
        .update(await readFile(absolutePath))
        .digest("hex");
    } catch (error: unknown) {
      this.onDiagnostic(`document hash failed: ${stringify(error)}`);
      return "";
    }
  }

  private entryFor(window: BrowserWindow): Entry {
    const existing = this.entries.get(window.id);
    if (existing) return existing;
    const view = new WebContentsView({
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: this.backgroundThrottling,
      },
    });
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-navigate", (event, url) => {
      if (url.startsWith(`${DOCUMENT_VIEW_SCHEME}://app/`)) return;
      event.preventDefault();
    });
    view.webContents.on("render-process-gone", (_event, details) => {
      this.onDiagnostic(`document view renderer gone: ${details.reason}`);
    });
    window.contentView.addChildView(view);
    const entry: Entry = { view, currentPath: null, pending: null };
    this.entries.set(window.id, entry);
    return entry;
  }

  /** `protocol.handle` entry point for the document scheme. */
  async assetResponse(requestUrl: string): Promise<Response> {
    try {
      const url = new URL(requestUrl);
      if (
        url.protocol !== `${DOCUMENT_VIEW_SCHEME}:` ||
        url.username ||
        url.password ||
        url.port ||
        url.hostname !== "app"
      ) {
        return unavailable();
      }
      if (url.pathname.startsWith("/_handoff/")) {
        const token = url.pathname.slice("/_handoff/".length);
        const handoff = this.handoffs.get(token);
        if (!handoff) return unavailable();
        const bytes = await readFile(handoff.absolutePath);
        return new Response(new Uint8Array(bytes), {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": DOCX_CONTENT_TYPE,
          },
        });
      }
      const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const file = await this.resolveAsset(relative);
      if (!file) return unavailable();
      const body = await readFile(file.absolutePath);
      return new Response(new Uint8Array(body), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": assetContentType(file.absolutePath),
        },
      });
    } catch (error: unknown) {
      this.onDiagnostic(`document view asset failed: ${stringify(error)}`);
      return unavailable();
    }
  }

  private async resolveAsset(relative: string): Promise<{ absolutePath: string } | null> {
    let decoded: string;
    try {
      decoded = decodeURIComponent(relative);
    } catch {
      return null;
    }
    if (
      !decoded ||
      decoded.includes("\0") ||
      decoded.includes("\\") ||
      decoded.startsWith("/") ||
      decoded.split("/").some((part) => part === ".." || part === "." || part === "")
    ) {
      return null;
    }
    const candidate = path.resolve(this.distRoot, decoded);
    const relativeToRoot = path.relative(this.distRoot, candidate);
    if (
      relativeToRoot === "" ||
      relativeToRoot.startsWith(`..${path.sep}`) ||
      relativeToRoot === ".." ||
      path.isAbsolute(relativeToRoot)
    ) {
      return null;
    }
    try {
      const resolved = await realpath(candidate);
      if (!(await stat(resolved)).isFile()) return null;
      return { absolutePath: resolved };
    } catch {
      return null;
    }
  }
}

function rectToBounds(rect: DocumentViewRect): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: Math.max(0, Math.round(rect.x)),
    y: Math.max(0, Math.round(rect.y)),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  };
}

function unavailable(): Response {
  return new Response("Unavailable", { status: 404 });
}

function assetContentType(file: string): string {
  const types: Readonly<Record<string, string>> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
  };
  return types[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

function stringify(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Register the scheme's privileges. Must run before `app.whenReady`. */
export function documentSchemePrivileges(): Electron.CustomScheme {
  return {
    scheme: DOCUMENT_VIEW_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  };
}

/** Install the protocol handler. Call once after `app.whenReady`. */
export function installDocumentProtocol(owner: DocumentViewOwner): void {
  protocol.handle(DOCUMENT_VIEW_SCHEME, (request) => owner.assetResponse(request.url));
}
