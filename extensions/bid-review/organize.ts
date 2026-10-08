import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rename, stat, symlink } from "node:fs/promises";
import { basename, join } from "node:path";
import type { WorkspaceZoneKind, WorkspaceZones } from "./workspace-types";

/**
 * Putting a workspace's files where its zones say they belong.
 *
 * Optional, previewable and idempotent: every action is computed first, applied
 * one at a time, and reported with what it did and what it refused. Nothing here
 * changes a file's contents — it only moves a file, or copies one in.
 */

export type OrganizeActionKind = "create-directory" | "move-into-zone";

export interface OrganizeAction {
  readonly kind: OrganizeActionKind;
  /** Workspace-relative path the action works on. */
  readonly path: string;
  /** Where a moved file lands, for `move-into-zone`. */
  readonly target?: string;
  readonly reason: string;
}

export interface OrganizePlan {
  readonly actions: readonly OrganizeAction[];
}

export interface OrganizeResult {
  readonly applied: readonly OrganizeAction[];
  /** Actions that could not be taken, with the reason. */
  readonly conflicts: readonly { readonly action: OrganizeAction; readonly reason: string }[];
}

/** The directories the workspace has at its top level. */
async function readTopLevelDirectories(workspacePath: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(workspacePath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * What the workspace would look like if its own zones were obeyed: directories
 * the profile names but that do not exist are created, and a document sitting
 * outside every zone is suggested into the zone that owns its kind.
 */
export async function planOrganization(input: {
  readonly workspacePath: string;
  readonly zones: WorkspaceZones;
  /** Workspace-relative files to consider placing. */
  readonly documents?: readonly string[];
  /** Where each document kind belongs; defaults to the input zone. */
  readonly zoneForDocument?: (path: string) => WorkspaceZoneKind;
  readonly existingDirectories?: readonly string[];
}): Promise<OrganizePlan> {
  const actions: OrganizeAction[] = [];
  const existing = new Set(
    input.existingDirectories ?? (await readTopLevelDirectories(input.workspacePath)),
  );

  for (const kind of ["reference", "material", "output", "feedback"] as const) {
    for (const directory of input.zones[kind]) {
      if (existing.has(directory)) continue;
      actions.push({
        kind: "create-directory",
        path: directory,
        reason: `档案把 ${directory}/ 声明为 ${kind} 分区，目录尚不存在`,
      });
    }
  }

  for (const document of input.documents ?? []) {
    // Only files that are really there, and really outside a zone: a plan that
    // names a file which is already placed is not a plan, it is noise.
    if (document.includes("/")) continue;
    if (!(await exists(join(input.workspacePath, document)))) continue;
    const kind = input.zoneForDocument?.(document) ?? "material";
    const target = input.zones[kind][0];
    if (!target) continue;
    actions.push({
      kind: "move-into-zone",
      path: document,
      target: join(target, basename(document)),
      reason: `文件不在任何分区内；按档案归入 ${target}/`,
    });
  }
  return { actions };
}

/** Apply a plan. A move keeps the bytes; an occupied target is refused, never overwritten. */
export async function applyOrganization(
  workspacePath: string,
  plan: OrganizePlan,
): Promise<OrganizeResult> {
  const applied: OrganizeAction[] = [];
  const conflicts: { action: OrganizeAction; reason: string }[] = [];

  for (const action of plan.actions) {
    const source = join(workspacePath, action.path);
    try {
      if (action.kind === "create-directory") {
        await mkdir(source, { recursive: true });
        applied.push(action);
        continue;
      }
      const target = join(workspacePath, action.target ?? "");
      if (await exists(target)) {
        conflicts.push({ action, reason: `${action.target} 已存在，未覆盖` });
        continue;
      }
      await mkdir(join(target, ".."), { recursive: true });
      await rename(source, target);
      applied.push(action);
    } catch (error) {
      conflicts.push({ action, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { applied, conflicts };
}

export type MountMode = "copy" | "symlink";

/**
 * Bring a file from outside the workspace in as a reference (R5).
 *
 * A copy is the default: it works on every filesystem, survives a backup and
 * needs no cleanup. A symlink is only made when the caller asks for it by name.
 */
export async function mountIntoZone(input: {
  readonly sourcePath: string;
  readonly workspacePath: string;
  /** Workspace-relative destination, inside a zone. */
  readonly target: string;
  readonly mode?: MountMode;
}): Promise<{ readonly target: string; readonly mode: MountMode }> {
  const destination = join(input.workspacePath, input.target);
  const mode = input.mode ?? "copy";
  await mkdir(join(destination, ".."), { recursive: true });
  if (await exists(destination)) {
    throw new Error(`${input.target} 已存在，未覆盖`);
  }
  if (mode === "symlink") {
    await symlink(input.sourcePath, destination);
    return { target: input.target, mode };
  }
  await copyFile(input.sourcePath, destination);
  const [before, after] = await Promise.all([digest(input.sourcePath), digest(destination)]);
  if (before !== after) {
    throw new Error("拷贝后内容不一致，已放弃");
  }
  return { target: input.target, mode };
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null)) !== null;
}

async function digest(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
