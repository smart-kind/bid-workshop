import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Pi's global configuration directory, mirroring the runtime's own resolution
 * (`getAgentDir()`). We resolve it locally rather than importing the runtime's
 * helper because `@earendil-works/pi-coding-agent` is ESM-only and cannot be
 * `require`d from the CJS Electron main bundle; the app passes no custom
 * `agentDir`, so the default resolution here matches the driver's.
 */
export function resolveAgentDir(): string {
  const override = process.env.PI_CODING_AGENT_DIR;
  if (!override) return join(homedir(), ".pi", "agent");
  return override.startsWith("~") ? join(homedir(), override.slice(1)) : override;
}
