import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The MCP servers a workspace says it relies on, checked against what is
 * configured.
 *
 * The profile only references servers by name; the credentials and the transport
 * live in `.pi/mcp.json` and are never copied into the profile. A name the
 * profile relies on that is not configured is reported — a review that silently
 * ran without its evidence source would look better founded than it is.
 */

export const MCP_CONFIG_PATH = [".pi", "mcp.json"] as const;

export interface ResolvedRunCapabilities {
  readonly servers: readonly string[];
  /** Names the profile relies on that are not configured in this workspace. */
  readonly missing: readonly string[];
}

/** The names the profile references, as far as they can be trusted. */
export async function readProfileMcp(workspacePath: string): Promise<readonly string[]> {
  try {
    const raw = await readFile(join(workspacePath, ".bid", "workspace.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const capabilities = (parsed as { capabilities?: unknown }).capabilities;
    if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) return [];
    const mcp = (capabilities as { mcp?: unknown }).mcp;
    if (!Array.isArray(mcp)) return [];
    return mcp.filter((name): name is string => typeof name === "string" && name.trim() !== "");
  } catch {
    return [];
  }
}

/** The server names configured in the workspace's own `.pi/mcp.json`. */
export async function readConfiguredMcpServers(workspacePath: string): Promise<readonly string[]> {
  try {
    const raw = await readFile(join(workspacePath, ...MCP_CONFIG_PATH), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const servers = (parsed as { mcpServers?: unknown }).mcpServers;
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) return [];
    return Object.keys(servers);
  } catch {
    return [];
  }
}

export async function resolveRunCapabilities(input: {
  readonly workspacePath: string;
  readonly names?: readonly string[];
}): Promise<ResolvedRunCapabilities> {
  const names = input.names ?? (await readProfileMcp(input.workspacePath));
  const configured = new Set(await readConfiguredMcpServers(input.workspacePath));
  return {
    servers: names.filter((name) => configured.has(name)),
    missing: names.filter((name) => !configured.has(name)),
  };
}

export function describeRunCapabilities(resolved: ResolvedRunCapabilities): string {
  const parts: string[] = [];
  if (resolved.servers.length > 0) parts.push(`本次可用数据源：${resolved.servers.join("、")}`);
  if (resolved.missing.length > 0) {
    parts.push(
      `档案里引用但本工作区未配置的 MCP server：${resolved.missing.join("、")}（相关判据无法核对）`,
    );
  }
  return parts.join("；");
}
