import { createHash, randomBytes } from "node:crypto";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * Writing a document to disk, the way the hosted editor's own shell does it.
 *
 * Same-dir temp file + rename, so a crash mid-write cannot truncate the target.
 */

/** Transient Windows codes: antivirus/indexer briefly locks the rename target. */
const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_RETRIES = 4;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Rename-over-existing fails transiently on Windows under Defender/indexer
 * locks: retry with backoff, then fall back to an in-place write — losing
 * atomicity for that one save beats failing a save that a plain write would
 * have completed.
 */
export async function atomicWriteDocument(filePath: string, data: Buffer): Promise<void> {
  const tmp = join(
    dirname(filePath),
    `.${basename(filePath)}.${randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    await writeFile(tmp, data);
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(tmp, filePath);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "";
        if (!RETRYABLE_RENAME_CODES.has(code) || attempt >= RENAME_RETRIES) throw error;
        await sleep(50 * 2 ** attempt);
      }
    }
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    if (RETRYABLE_RENAME_CODES.has((error as NodeJS.ErrnoException).code ?? "")) {
      await writeFile(filePath, data);
      return;
    }
    throw error;
  }
}

/** A document's disk state as of the last read or write. */
export interface DiskFileState {
  readonly mtimeMs: number;
  readonly size: number;
  readonly hash: string;
}

export async function readDiskFileState(filePath: string): Promise<DiskFileState | undefined> {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) return undefined;
  return { mtimeMs: info.mtimeMs, size: info.size, hash: await hashFile(filePath) };
}

export async function hashFile(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

/**
 * True when the file on disk no longer matches the recorded state, i.e. another
 * program wrote it since we last read or saved it. No record (never tracked) or
 * a missing file (deleted externally) is not a conflict — the save proceeds and
 * recreates it. The hash read only runs when mtime and size already disagree,
 * so the common no-conflict save never re-reads the file.
 */
export async function isExternallyModified(
  recorded: DiskFileState | undefined,
  currentPath: string,
): Promise<boolean> {
  if (!recorded) return false;
  const current = await stat(currentPath).catch(() => null);
  if (!current?.isFile()) return false;
  if (current.mtimeMs === recorded.mtimeMs && current.size === recorded.size) return false;
  return (await hashFile(currentPath)) !== recorded.hash;
}
