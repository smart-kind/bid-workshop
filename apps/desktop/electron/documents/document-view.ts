import { createHash, randomUUID } from "node:crypto";
import { copyFile, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import path, { dirname, join } from "node:path";
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
  /** Whether a new view starts with the editor's built-in AI panel showing. */
  readonly aiPanelDefault?: () => boolean;
  /** The view reporting what its own chrome is doing, for the host's menu. */
  readonly onViewMenuState?: (state: DocumentViewMenuState) => void;
  /**
   * Refuse a write the workspace's zones do not allow. The editor never decides
   * this: it asks, and the host answers.
   */
  readonly assertWritableDocument?: (absolutePath: string) => Promise<void>;
  /** Where the shell asks for a target when the editor saves a document elsewhere. */
  readonly chooseSavePath?: (input: {
    readonly suggestedName: string;
    readonly sourcePath?: string;
  }) => Promise<string | undefined>;
}

/** What the editor asks the shell to do with a document it has serialized. */
export interface WriteDocumentRequest {
  readonly mode: "save" | "save-as" | "save-new" | "save-to";
  readonly path?: string;
  readonly name?: string;
  readonly sourcePath?: string;
  readonly overwrite?: boolean;
  readonly bytes: Uint8Array;
}

export interface WriteDocumentResult {
  readonly ok: boolean;
  readonly path?: string;
  readonly error?: string;
  /** `external-modified` when the file changed on disk since it was opened. */
  readonly reason?: string;
}

/** What the hosted editor tells the host about its own chrome. */
export interface DocumentViewMenuState {
  readonly aiSidebar?: boolean;
  readonly darkCanvas?: boolean;
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
  private readonly aiPanelDefault: () => boolean;
  private readonly onViewMenuState: (state: DocumentViewMenuState) => void;
  private readonly assertWritableDocument: (absolutePath: string) => Promise<void>;
  private readonly chooseSavePath?: DocumentViewOwnerOptions["chooseSavePath"];
  /** The last state a view reported, so a menu can start from it. */
  reportedViewMenuState: DocumentViewMenuState | null = null;
  /** Content digest of each document as it was opened, to notice outside edits. */
  private readonly openedDigests = new Map<string, string>();

  constructor(options: DocumentViewOwnerOptions) {
    this.distRoot = options.distRoot;
    this.preloadPath = options.preloadPath;
    this.backgroundThrottling = options.backgroundThrottling ?? true;
    this.onDiagnostic = options.onDiagnostic ?? (() => {});
    this.aiPanelDefault = options.aiPanelDefault ?? (() => false);
    this.onViewMenuState = options.onViewMenuState ?? (() => {});
    this.assertWritableDocument = options.assertWritableDocument ?? (async () => {});
    this.chooseSavePath = options.chooseSavePath;
  }

  /** Register the doc preload's boot IPC. Called once before any view is created. */
  installIpc(): void {
    ipcMain.handle(DOCUMENT_IPC.consumePendingOpen, (event) =>
      this.pendingDocument(event.sender.id),
    );
    ipcMain.handle(DOCUMENT_IPC.consumeNewBlank, () => false);
    ipcMain.handle(DOCUMENT_IPC.consumeAiDocContent, () => null);
    // Answered synchronously at boot: the preload has to know before the editor
    // renders, and a reload must see the host's current choice, not the one the
    // view was first created with.
    ipcMain.handle(DOCUMENT_IPC.writeDocument, (_event, payload: unknown) =>
      this.writeDocument(payload),
    );
    ipcMain.on(DOCUMENT_IPC.aiPanelDefault, (event) => {
      event.returnValue = this.aiPanelDefault() ? "1" : "0";
    });
    ipcMain.on(DOCUMENT_IPC.reportViewMenuState, (_event, state: unknown) => {
      const parsed = parseViewMenuState(state);
      if (!parsed) return;
      this.reportedViewMenuState = parsed;
      this.onViewMenuState(parsed);
    });
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
    this.noteOpenedDocument(input.absolutePath);
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

  /**
   * Write a document the editor serialized. The shell decides: the workspace's
   * zones are checked first, a change on disk since the document was opened
   * aborts the write, and the file that was there is kept as a timestamped
   * backup before the new bytes take its place.
   */
  async writeDocument(payload: unknown): Promise<WriteDocumentResult> {
    const request = parseWriteDocumentRequest(payload);
    if (!request) return { ok: false, error: "无法识别的保存请求" };

    try {
      if (request.mode === "save-new") {
        return {
          ok: false,
          error: "新文档还没有位置：请先另存为，选择一个工作区内的目录",
        };
      }
      const target =
        request.mode === "save-as"
          ? await this.chooseSavePath?.({
              suggestedName: request.name ?? "未命名.docx",
              ...(request.sourcePath ? { sourcePath: request.sourcePath } : {}),
            })
          : request.path;
      if (!target) return { ok: false, error: "没有选择保存位置" };

      await this.assertWritableDocument(target);

      const existing = await stat(target).catch(() => null);
      if (existing?.isFile() && request.mode !== "save-to") {
        // The editor holds the bytes it loaded; if the file moved underneath it,
        // writing would silently drop whatever else changed it.
        const opened = this.digestFor(target);
        if (opened && opened !== (await digestFile(target))) {
          return {
            ok: false,
            reason: "external-modified",
            error: "文件在编辑器之外被改动过，未覆盖；请重新打开后再保存",
          };
        }
      }
      if (existing?.isFile() && request.mode === "save-to" && request.overwrite === false) {
        return { ok: false, error: `${target} 已存在` };
      }

      const backupPath = existing?.isFile() ? await backupFile(target) : undefined;
      await writeBytesAtomically(target, Buffer.from(request.bytes));
      this.rememberDigest(target, await digestFile(target));
      void backupPath;
      return { ok: true, path: target };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private digestFor(path: string): string | undefined {
    return this.openedDigests.get(path);
  }

  private rememberDigest(path: string, digest: string): void {
    this.openedDigests.set(path, digest);
  }

  /** Remember what a document looked like when it was handed to the editor. */
  private noteOpenedDocument(path: string): void {
    void digestFile(path)
      .then((digest) => this.rememberDigest(path, digest))
      .catch(() => undefined);
  }

  /** Re-boot every live view so it picks up the host's current preferences. */
  reloadViews(): void {
    for (const entry of this.entries.values()) {
      if (entry.view.webContents.getURL()) entry.view.webContents.reload();
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

/** The editor's chrome report, narrowed to the fields the host understands. */
export function parseViewMenuState(value: unknown): DocumentViewMenuState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const state = value as { aiSidebar?: unknown; darkCanvas?: unknown };
  const parsed: { aiSidebar?: boolean; darkCanvas?: boolean } = {};
  if (typeof state.aiSidebar === "boolean") parsed.aiSidebar = state.aiSidebar;
  if (typeof state.darkCanvas === "boolean") parsed.darkCanvas = state.darkCanvas;
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function parseWriteDocumentRequest(value: unknown): WriteDocumentRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const request = value as Record<string, unknown>;
  const mode = request.mode;
  if (mode !== "save" && mode !== "save-as" && mode !== "save-new" && mode !== "save-to") {
    return undefined;
  }
  const bytes = request.bytes;
  if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) return undefined;
  return {
    mode,
    bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    ...(typeof request.path === "string" ? { path: request.path } : {}),
    ...(typeof request.name === "string" ? { name: request.name } : {}),
    ...(typeof request.sourcePath === "string" ? { sourcePath: request.sourcePath } : {}),
    ...(typeof request.overwrite === "boolean" ? { overwrite: request.overwrite } : {}),
  };
}

async function digestFile(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

/** Keep what was on disk, under a name that says when it was set aside. */
async function backupFile(path: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(dirname(path), `${path.slice(dirname(path).length + 1)}.bak-${stamp}`);
  await copyFile(path, backupPath);
  return backupPath;
}

/** Temp file + rename, so a crash cannot leave a half-written document behind. */
async function writeBytesAtomically(path: string, bytes: Buffer): Promise<void> {
  const scratch = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(scratch, bytes);
    await rename(scratch, path);
  } catch (error) {
    await unlink(scratch).catch(() => undefined);
    throw error;
  }
}
