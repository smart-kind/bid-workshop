import { realpath } from "node:fs/promises";
import path from "node:path";

export function resolveWorkspacePath(workspacePath: string, filePath: string): string {
  const workspaceRoot = path.resolve(workspacePath);
  const resolved = path.resolve(workspaceRoot, filePath);
  assertInsideWorkspace(workspaceRoot, resolved);
  return resolved;
}

/**
 * A path inside a workspace, with symlinks resolved. `root` and `path` come from
 * the same resolution, so a relative path measured between them stays inside the
 * workspace even when the workspace root itself is reached through a symlink
 * (macOS reaches `/var/folders/...` as `/private/var/folders/...`).
 */
export interface ResolvedWorkspaceFile {
  readonly root: string;
  readonly path: string;
}

export async function resolveExistingWorkspaceFile(
  workspacePath: string,
  filePath: string,
): Promise<ResolvedWorkspaceFile> {
  const resolved = resolveWorkspacePath(workspacePath, filePath);
  const [root, target] = await Promise.all([
    realpath(path.resolve(workspacePath)),
    realpath(resolved),
  ]);
  assertInsideWorkspace(root, target);
  return { root, path: target };
}

export async function resolveExistingWorkspacePath(
  workspacePath: string,
  filePath: string,
): Promise<string> {
  return (await resolveExistingWorkspaceFile(workspacePath, filePath)).path;
}

function assertInsideWorkspace(workspaceRoot: string, candidate: string): void {
  const relative = path.relative(workspaceRoot, candidate);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return;
  }
  throw new Error("Path escapes workspace");
}
