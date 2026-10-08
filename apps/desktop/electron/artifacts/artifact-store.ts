import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { readJsonWithBackup, writeFileAtomicQueued } from "../persistence/atomic-file-write";

const ARTIFACTS_DIR = "artifacts";
const INDEX_FILE = "workspaces.json";
const COMPLETE_MARKER = ".complete";
const KEY_LENGTH = 16;

/** Keep the newest N completed runs per workspace. */
export const DEFAULT_MAX_RUNS_PER_WORKSPACE = 20;
/** Keep at most this many bytes of completed runs per workspace. */
export const DEFAULT_MAX_BYTES_PER_WORKSPACE = 512 * 1024 * 1024;

export interface ArtifactRunRef {
  readonly workspacePath: string;
  readonly sessionId: string;
  readonly runId: string;
}

export interface ArtifactEntry {
  /** Workspace-run-relative POSIX path. */
  readonly name: string;
  readonly bytes: number;
}

export interface ArtifactCleanupResult {
  /** `<sessionId>/<runId>` of the runs that were removed, oldest first. */
  readonly removedRuns: readonly string[];
  readonly retainedRuns: readonly string[];
}

export interface ArtifactStoreLimits {
  readonly maxRunsPerWorkspace: number;
  readonly maxBytesPerWorkspace: number;
}

/**
 * Internal products nobody sees: parsed text, extracted media, per-run traces.
 * They live under `<userData>/artifacts/<workspaceKey>/<sessionId>/<runId>/`,
 * where `workspaceKey` is a stable digest of the workspace's real path, so two
 * workspaces can never see each other's products and the same workspace keeps
 * the same key across runs.
 *
 * This store must not be exposed to the renderer: it has no "list the directory
 * of products" capability on purpose. Callers read a named product of a run.
 */
export class ArtifactStoreOwner {
  private readonly rootDir: string;
  private readonly indexPath: string;
  private readonly limits: ArtifactStoreLimits;

  constructor(
    userDataDir: string,
    limits: ArtifactStoreLimits = {
      maxRunsPerWorkspace: DEFAULT_MAX_RUNS_PER_WORKSPACE,
      maxBytesPerWorkspace: DEFAULT_MAX_BYTES_PER_WORKSPACE,
    },
  ) {
    this.rootDir = join(userDataDir, ARTIFACTS_DIR);
    this.indexPath = join(this.rootDir, INDEX_FILE);
    this.limits = limits;
  }

  /** Stable digest of the workspace's real path; also records it for reverse lookup. */
  async keyFor(workspacePath: string): Promise<string> {
    const canonical = await canonicalWorkspacePath(workspacePath);
    const key = createHash("sha256").update(canonical).digest("hex").slice(0, KEY_LENGTH);
    const index = await this.readIndex();
    if (index[key] !== canonical) {
      await this.writeIndex({ ...index, [key]: canonical });
    }
    return key;
  }

  /** Reverse lookup of the recorded workspace path for a key. */
  async workspacePathFor(key: string): Promise<string | undefined> {
    return (await this.readIndex())[key];
  }

  /** Diagnostics entry point: what a single run left behind, without listing anything else. */
  async listRun(ref: ArtifactRunRef): Promise<readonly ArtifactEntry[]> {
    const directory = await this.runDirectory(ref);
    const entries: ArtifactEntry[] = [];
    await collectEntries(directory, "", entries);
    return entries.sort((left, right) => left.name.localeCompare(right.name));
  }

  async writeArtifact(
    ref: ArtifactRunRef,
    name: string,
    contents: string | Buffer,
  ): Promise<string> {
    const path = await this.artifactPath(ref, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
    return path;
  }

  async readArtifact(ref: ArtifactRunRef, name: string): Promise<Buffer | undefined> {
    const path = await this.artifactPath(ref, name);
    try {
      return await readFile(path);
    } catch (error) {
      if (isMissingFileError(error)) return undefined;
      throw error;
    }
  }

  /** Marks the run finished; only marked runs become candidates for cleanup. */
  async markRunComplete(ref: ArtifactRunRef): Promise<void> {
    const directory = await this.runDirectory(ref);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, COMPLETE_MARKER), "");
  }

  /**
   * Remove old completed runs of one workspace: newest-first retention by count
   * and total size, oldest removed first. Unfinished runs are never removed, and
   * nothing outside this workspace's own directory is touched.
   */
  async cleanup(workspacePath: string): Promise<ArtifactCleanupResult> {
    const key = await this.keyFor(workspacePath);
    const workspaceDir = join(this.rootDir, key);
    const runs = await collectRuns(workspaceDir);
    const completed = runs
      .filter((run) => run.complete)
      .sort((left, right) => right.modifiedMs - left.modifiedMs);
    const survivors = [...completed];
    const removed: RunInfo[] = [];
    while (survivors.length > this.limits.maxRunsPerWorkspace) {
      const victim = survivors.pop();
      if (victim) removed.push(victim);
    }
    let totalBytes = survivors.reduce((sum, run) => sum + run.bytes, 0);
    while (survivors.length > 0 && totalBytes > this.limits.maxBytesPerWorkspace) {
      const victim = survivors.pop();
      if (!victim) break;
      totalBytes -= victim.bytes;
      removed.push(victim);
    }
    for (const run of removed) await rm(run.directory, { recursive: true, force: true });
    return {
      removedRuns: removed.map((run) => run.id).sort(),
      retainedRuns: [...survivors, ...runs.filter((run) => !run.complete)]
        .map((run) => run.id)
        .sort(),
    };
  }

  /**
   * Where this run's products live. Exposed for diagnostics (reveal the folder);
   * it is not a listing capability.
   */
  async runDirectory(ref: ArtifactRunRef): Promise<string> {
    const key = await this.keyFor(ref.workspacePath);
    return join(
      this.rootDir,
      key,
      segment(ref.sessionId, "sessionId"),
      segment(ref.runId, "runId"),
    );
  }

  private async artifactPath(ref: ArtifactRunRef, name: string): Promise<string> {
    const directory = await this.runDirectory(ref);
    const parts = name.split("/").filter((part) => part !== "");
    if (parts.length === 0) throw new Error(`Invalid artifact name ${JSON.stringify(name)}`);
    return join(directory, ...parts.map((part) => segment(part, "artifact name")));
  }

  private async readIndex(): Promise<Record<string, string>> {
    const result = await readJsonWithBackup(this.indexPath);
    return decodeIndex(result.value);
  }

  /**
   * The index is app-side bookkeeping, but a damaged one is still preserved
   * under a timestamped name rather than discarded, then rebuilt from the
   * entries the store can still observe.
   */
  private async writeIndex(index: Record<string, string>): Promise<void> {
    const existing = await readJsonWithBackup(this.indexPath);
    if (existing.corrupted && !existing.recovered) {
      await rename(this.indexPath, `${this.indexPath}.corrupt-${Date.now()}`);
    }
    await writeFileAtomicQueued(this.indexPath, `${JSON.stringify(index, null, 2)}\n`, decodeIndex);
  }
}

interface RunInfo {
  /** `<sessionId>/<runId>` */
  readonly id: string;
  readonly directory: string;
  readonly complete: boolean;
  readonly modifiedMs: number;
  readonly bytes: number;
}

async function collectRuns(workspaceDir: string): Promise<RunInfo[]> {
  const runs: RunInfo[] = [];
  for (const sessionId of await safeReaddir(workspaceDir)) {
    const sessionDir = join(workspaceDir, sessionId);
    if (!(await isDirectory(sessionDir))) continue;
    for (const runId of await safeReaddir(sessionDir)) {
      const directory = join(sessionDir, runId);
      if (!(await isDirectory(directory))) continue;
      const info = await stat(directory);
      runs.push({
        id: `${sessionId}/${runId}`,
        directory,
        complete: await fileExists(join(directory, COMPLETE_MARKER)),
        modifiedMs: info.mtimeMs,
        bytes: await directoryBytes(directory),
      });
    }
  }
  return runs;
}

async function canonicalWorkspacePath(workspacePath: string): Promise<string> {
  try {
    return await realpath(workspacePath);
  } catch {
    return resolve(workspacePath);
  }
}

/** One path segment that cannot climb out of the artifacts root. */
function segment(value: string, label: string): string {
  if (!value || value === "." || value === ".." || /[/\\\0]/.test(value)) {
    throw new Error(`Invalid ${label} ${JSON.stringify(value)}`);
  }
  return value;
}

function decodeIndex(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const index: Record<string, string> = {};
  for (const [key, path] of Object.entries(value)) {
    if (/^[0-9a-f]{16}$/.test(key) && typeof path === "string" && path.startsWith(sep)) {
      index[key] = path;
    }
  }
  return index;
}

async function collectEntries(
  directory: string,
  prefix: string,
  entries: ArtifactEntry[],
): Promise<void> {
  for (const entry of await safeReaddir(directory)) {
    if (!prefix && entry === COMPLETE_MARKER) continue;
    const path = join(directory, entry);
    const info = await stat(path);
    if (info.isDirectory()) {
      await collectEntries(path, `${prefix}${entry}/`, entries);
    } else {
      entries.push({ name: `${prefix}${entry}`, bytes: info.size });
    }
  }
}

async function directoryBytes(directory: string): Promise<number> {
  const entries: ArtifactEntry[] = [];
  await collectEntries(directory, "", entries);
  return entries.reduce((sum, entry) => sum + entry.bytes, 0);
}

async function safeReaddir(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
