/**
 * Zone resolution for a business workspace: workspace-relative path → zone kind.
 *
 * Pure logic, shared by the main-process write gate, the renderer's read-only
 * marking and the workspace context bar. Declarative and fail-safe:
 *
 * - only directories explicitly declared as `reference`/`material` are read-only;
 * - a path nothing declares stays writable (design §5.1: flat workspaces have no
 *   read-only directories at all);
 * - the most specific declaration wins, and when two declarations of the same
 *   depth disagree, read-only wins — never silently widen the writable surface.
 */

import {
  READ_ONLY_WORKSPACE_ZONES,
  WORKSPACE_ZONE_KINDS,
  type WorkspaceContext,
  type WorkspaceProfile,
  type WorkspaceZoneKind,
  type WorkspaceZones,
} from "./business-workspace";

export interface WorkspaceZoneEntry {
  /** Normalized workspace-relative POSIX directory path. */
  readonly path: string;
  readonly kind: WorkspaceZoneKind;
  readonly readOnly: boolean;
}

export interface WorkspaceZoneResolver {
  /** False when no directory is declared: the workspace is flat. */
  readonly isZoned: boolean;
  readonly entries: readonly WorkspaceZoneEntry[];
  zoneOf(relPath: string): WorkspaceZoneKind | undefined;
  isReadOnlyPath(relPath: string): boolean;
  /** No-op for writable paths; throws a readable reason otherwise. */
  assertWritable(relPath: string): void;
}

export function createZoneResolver(zones: WorkspaceZones): WorkspaceZoneResolver {
  const entries: WorkspaceZoneEntry[] = [];
  for (const kind of WORKSPACE_ZONE_KINDS) {
    for (const declared of zones[kind]) {
      const path = normalizeRelativePath(declared);
      if (path === null || path === "") {
        throw new Error(`Invalid workspace zones: ${kind} entry ${JSON.stringify(declared)}`);
      }
      entries.push({ path, kind, readOnly: READ_ONLY_WORKSPACE_ZONES.includes(kind) });
    }
  }

  const match = (
    relPath: string,
  ): { entry: WorkspaceZoneEntry; normalized: string } | undefined => {
    const normalized = normalizeRelativePath(relPath);
    if (normalized === null) return undefined;
    const folded = normalized.toLowerCase();
    let best: WorkspaceZoneEntry | undefined;
    for (const entry of entries) {
      const dir = entry.path.toLowerCase();
      if (folded !== dir && !folded.startsWith(`${dir}/`)) continue;
      if (best === undefined || entry.path.length > best.path.length) {
        best = entry;
        continue;
      }
      if (entry.path.length === best.path.length && entry.readOnly && !best.readOnly) {
        best = entry;
      }
    }
    return best === undefined ? undefined : { entry: best, normalized };
  };

  return {
    isZoned: entries.length > 0,
    entries,
    zoneOf(relPath) {
      return match(relPath)?.entry.kind;
    },
    isReadOnlyPath(relPath) {
      return match(relPath)?.entry.readOnly ?? false;
    },
    assertWritable(relPath) {
      if (normalizeRelativePath(relPath) === null) {
        throw new Error(`Refusing to write ${JSON.stringify(relPath)}: outside the workspace`);
      }
      const found = match(relPath);
      if (found?.entry.readOnly) {
        throw new Error(
          `Refusing to write ${JSON.stringify(relPath)}: ${found.entry.path}/ is a read-only ` +
            `${found.entry.kind} zone`,
        );
      }
    },
  };
}

/**
 * The serializable context a decoded profile projects: what the workspace is,
 * which directories are zoned, and the enable-list/delivery defaults.
 */
export function deriveWorkspaceContext(profile: WorkspaceProfile): WorkspaceContext {
  return {
    business: profile.business,
    ...(profile.name === undefined ? {} : { name: profile.name }),
    ...(profile.goal === undefined ? {} : { goal: profile.goal }),
    zones: profile.zones,
    zoned: createZoneResolver(profile.zones).isZoned,
    skills: profile.skills,
    mcp: profile.capabilities.mcp,
    delivery: profile.delivery,
  };
}

/**
 * Normalize a workspace-relative path to POSIX segments, resolving `.` and `..`.
 * Returns `null` for absolute paths, Windows drive paths, NUL bytes and any path
 * that escapes the workspace root. Returns `""` for the workspace root itself.
 */
export function normalizeRelativePath(value: string): string | null {
  if (typeof value !== "string" || value.includes("\0")) return null;
  const replaced = value.replace(/\\/g, "/");
  if (replaced.startsWith("/") || /^[A-Za-z]:/.test(replaced)) return null;
  const segments: string[] = [];
  for (const segment of replaced.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}
