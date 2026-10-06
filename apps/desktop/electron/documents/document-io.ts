import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, dialog, type BrowserWindow } from "electron";

/**
 * The file side of the hosted document editor: writing a saved document back,
 * choosing a path for Save As / New, and the recent-documents list.
 *
 * The renderer hands over finished docx bytes and nothing else — it never learns
 * a path it was not given, and every write here goes through the atomic
 * temporary-then-rename dance so a crash mid-save cannot truncate a document the
 * user is working on.
 */

const RECENT_LIMIT = 10;

/** Writes `bytes` over `absolutePath`, keeping the file's existing permissions. */
export async function writeDocumentFile(absolutePath: string, bytes: Uint8Array): Promise<void> {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const mode = await existingMode(absolutePath);
  const temporary = path.join(
    path.dirname(absolutePath),
    `.${path.basename(absolutePath)}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, bytes, mode === undefined ? {} : { mode });
    await rename(temporary, absolutePath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function existingMode(absolutePath: string): Promise<number | undefined> {
  try {
    return (await stat(absolutePath)).mode & 0o777;
  } catch {
    return undefined;
  }
}

export interface SaveAsOutcome {
  readonly ok: boolean;
  readonly path?: string;
  readonly error?: string;
  readonly cancelled?: boolean;
}

/** Asks where to put the document, then writes it. Cancelling is not an error. */
export async function saveDocumentAs(
  window: BrowserWindow | undefined,
  defaultName: string,
  bytes: Uint8Array,
): Promise<SaveAsOutcome> {
  const options: Electron.SaveDialogOptions = { defaultPath: defaultName };
  const picked = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);
  if (picked.canceled || !picked.filePath) {
    return { ok: false, cancelled: true };
  }
  try {
    await writeDocumentFile(picked.filePath, bytes);
    return { ok: true, path: picked.filePath };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

export async function fileExists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
}

/** A free path in the user's documents folder for a document that has never been saved. */
export async function freeDocumentPath(defaultName: string): Promise<string> {
  const directory = app.getPath("documents");
  const stem = safeStem(defaultName);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = path.join(
      directory,
      attempt === 0 ? `${stem}.docx` : `${stem} ${attempt + 1}.docx`,
    );
    if (!(await fileExists(candidate))) return candidate;
  }
  return path.join(directory, `${stem} ${Date.now()}.docx`);
}

function safeStem(defaultName: string): string {
  const withoutExtension = defaultName.replace(/\.docx$/i, "");
  const cleaned = withoutExtension.replace(/[/\\:*?"<>|]/g, " ").trim();
  return cleaned === "" ? "Untitled" : cleaned;
}

function recentFile(): string {
  return path.join(app.getPath("userData"), "recent-documents.json");
}

export async function readRecentDocuments(): Promise<string[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(recentFile(), "utf8"));
  } catch {
    return [];
  }
  if (typeof raw !== "object" || raw === null || !("paths" in raw)) return [];
  const paths: unknown = (raw as { paths?: unknown }).paths;
  if (!Array.isArray(paths)) return [];
  return paths.filter((entry): entry is string => typeof entry === "string").slice(0, RECENT_LIMIT);
}

/** Records a document as most-recently-used; never fails a save because of this. */
export async function rememberRecentDocument(absolutePath: string): Promise<void> {
  try {
    const existing = await readRecentDocuments();
    const next = [absolutePath, ...existing.filter((entry) => entry !== absolutePath)].slice(
      0,
      RECENT_LIMIT,
    );
    await writeFile(recentFile(), `${JSON.stringify({ paths: next }, null, 2)}\n`, "utf8");
  } catch (error) {
    console.warn("[document-io] recording the recent document failed", messageOf(error));
  }
}

/** Where a crash-recovery copy of `absolutePath` lives. Kept out of the workspace. */
export function recoveryCopyPath(absolutePath: string): string {
  const directory = path.join(app.getPath("userData"), "document-recovery");
  const stem = path.basename(absolutePath).replace(/[/\\:*?"<>|]/g, " ");
  return path.join(directory, `${stem}.recovered.docx`);
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
