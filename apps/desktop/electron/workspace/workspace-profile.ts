import { rename } from "node:fs/promises";
import { join } from "node:path";
import {
  WORKSPACE_PROFILE_RELATIVE_PATH,
  decodeWorkspaceProfile,
  type WorkspaceContext,
  type WorkspaceProfile,
} from "../../contracts/business-workspace";
import {
  createZoneResolver,
  deriveWorkspaceContext,
  type WorkspaceZoneResolver,
} from "../../contracts/workspace-zones";
import { readJsonWithBackup, writeFileAtomicQueued } from "../persistence/atomic-file-write";

/**
 * Reading `.bid/workspace.json` never throws: a broken profile must not block
 * opening the folder, it only marks the business layer as unavailable.
 */
export type WorkspaceProfileState =
  | {
      readonly status: "ok";
      readonly path: string;
      readonly profile: WorkspaceProfile;
      readonly context: WorkspaceContext;
      readonly zones: WorkspaceZoneResolver;
      /** The primary file was broken and the value came from its `.bak` sibling. */
      readonly recoveredFromBackup: boolean;
    }
  | { readonly status: "missing"; readonly path: string }
  | { readonly status: "invalid"; readonly path: string; readonly reason: string };

/**
 * Owns the business profile of a workspace: read, validate, write, rebuild.
 * It knows nothing about Pi sessions or file contents.
 */
export class WorkspaceProfileOwner {
  profilePath(workspacePath: string): string {
    return join(workspacePath, WORKSPACE_PROFILE_RELATIVE_PATH);
  }

  async read(workspacePath: string): Promise<WorkspaceProfileState> {
    const path = this.profilePath(workspacePath);
    const existing = await readJsonWithBackup(path);
    if (existing.value === undefined) {
      return existing.corrupted
        ? { status: "invalid", path, reason: "档案无法解析，且没有可用的备份" }
        : { status: "missing", path };
    }
    try {
      const profile = decodeWorkspaceProfile(existing.value);
      return {
        status: "ok",
        path,
        profile,
        context: deriveWorkspaceContext(profile),
        zones: createZoneResolver(profile.zones),
        recoveredFromBackup: existing.recovered,
      };
    } catch (error) {
      return { status: "invalid", path, reason: errorMessage(error) };
    }
  }

  /**
   * Durable write: temp file + rename, and the previous version is retained as
   * `<path>.bak`. A corrupt profile is never silently replaced — the write fails
   * and the original bytes stay put until {@link rebuild} is chosen explicitly.
   */
  async write(workspacePath: string, profile: WorkspaceProfile): Promise<void> {
    const path = this.profilePath(workspacePath);
    const decoded = decodeWorkspaceProfile(profile);
    createZoneResolver(decoded.zones);
    await writeFileAtomicQueued(
      path,
      `${JSON.stringify(decoded, null, 2)}\n`,
      decodeWorkspaceProfile,
    );
  }

  /**
   * Rebuild an unusable profile. The rejected bytes are moved aside under a
   * timestamped name — preserved, never overwritten or deleted — and a fresh
   * profile takes their place. Covers both unparsable JSON and a profile this
   * version refuses (unsupported schema, unknown fields).
   */
  async rebuild(workspacePath: string, profile: WorkspaceProfile): Promise<void> {
    const path = this.profilePath(workspacePath);
    if ((await this.read(workspacePath)).status === "invalid") {
      await rename(path, `${path}.corrupt-${Date.now()}`);
    }
    await this.write(workspacePath, profile);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
