import { EMPTY_WORKSPACE_ZONES } from "../../contracts/business-workspace";
import { createZoneResolver } from "../../contracts/workspace-zones";
import type { WorkspaceProfileOwner } from "./workspace-profile";

/**
 * The single gate every main-process write into a workspace goes through.
 *
 * Read-only zones are refused here rather than by disabling UI: a renderer or
 * an extension that reaches the write path directly hits the same refusal, with
 * the same readable reason. A workspace with no usable profile has no zone
 * declarations, so only paths outside the workspace itself are refused.
 */
export async function assertWorkspaceWriteAllowed(
  profiles: WorkspaceProfileOwner,
  workspacePath: string,
  relativePath: string,
): Promise<void> {
  const state = await profiles.read(workspacePath);
  const zones = state.status === "ok" ? state.zones : createZoneResolver(EMPTY_WORKSPACE_ZONES);
  zones.assertWritable(relativePath);
}
