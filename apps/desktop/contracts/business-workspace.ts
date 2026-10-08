/**
 * Business workspace profile (`.bid/workspace.json`).
 *
 * Declarative and almost entirely optional: it tells the app which business
 * pack a folder belongs to and how its directories are zoned. See
 * docs/business-workspace-design.md §5.2.
 */

export const WORKSPACE_PROFILE_SCHEMA_VERSION = 1;

/** Workspace-relative location of the profile file. */
export const WORKSPACE_PROFILE_RELATIVE_PATH = ".bid/workspace.json";

export const WORKSPACE_ZONE_KINDS = ["reference", "material", "output", "feedback"] as const;

export type WorkspaceZoneKind = (typeof WORKSPACE_ZONE_KINDS)[number];

/** Zone kinds that hold inputs the workspace does not own; never written through. */
export const READ_ONLY_WORKSPACE_ZONES: readonly WorkspaceZoneKind[] = ["reference", "material"];

/** Every zone kind maps to the workspace-relative directories that declare it. */
export type WorkspaceZones = { readonly [Kind in WorkspaceZoneKind]: readonly string[] };

export interface WorkspaceCapabilities {
  /** Names of `.pi/mcp.json` servers this workspace references. Credentials stay there. */
  readonly mcp: readonly string[];
}

export type WorkspaceCommentTarget = "copy" | "inPlace";

export interface WorkspaceDelivery {
  readonly commentTarget: WorkspaceCommentTarget;
  readonly outputSuffix: string;
  readonly criteriaFile: string;
}

/**
 * A decoded profile. Optional fields are always present here: decoding fills the
 * flat/all-default shape, so callers never branch on "declared or not".
 */
export interface WorkspaceProfile {
  readonly schemaVersion: number;
  readonly business: string;
  readonly name?: string;
  readonly goal?: string;
  readonly zones: WorkspaceZones;
  readonly skills: readonly string[];
  readonly capabilities: WorkspaceCapabilities;
  readonly delivery: WorkspaceDelivery;
}

export const EMPTY_WORKSPACE_ZONES: WorkspaceZones = {
  reference: [],
  material: [],
  output: [],
  feedback: [],
};

export const DEFAULT_WORKSPACE_DELIVERY: WorkspaceDelivery = {
  commentTarget: "copy",
  outputSuffix: "-批注",
  criteriaFile: "评审条件.md",
};

/**
 * What the rest of the app derives from a profile: the business type, the zone
 * declarations, the skill enable-list, the referenced MCP servers and the
 * delivery defaults. Serializable, so the main process can project it to the
 * renderer without shipping the resolver.
 *
 * Named `Business…` to stay distinct from the renderer's own workspace-selection
 * context (`apps/desktop/src/app/workspace-context.ts`).
 */
export interface BusinessWorkspaceContext {
  readonly business: string;
  readonly name?: string;
  readonly goal?: string;
  readonly zones: WorkspaceZones;
  /** False when no directory is declared: the workspace is flat. */
  readonly zoned: boolean;
  readonly skills: readonly string[];
  /** `.pi/mcp.json` server names this workspace references. */
  readonly mcp: readonly string[];
  readonly delivery: WorkspaceDelivery;
}

const MAX_TEXT_LENGTH = 4096;
const MAX_LIST_ITEMS = 512;

const PROFILE_KEYS = [
  "schemaVersion",
  "business",
  "name",
  "goal",
  "zones",
  "skills",
  "capabilities",
  "delivery",
] as const;
const CAPABILITY_KEYS = ["mcp"] as const;
const DELIVERY_KEYS = ["commentTarget", "outputSuffix", "criteriaFile"] as const;

/**
 * Decode an untrusted profile value. Unsupported versions, wrong types and
 * unknown fields are rejected rather than dropped; missing optional fields are
 * filled from the defaults.
 */
export function decodeWorkspaceProfile(value: unknown): WorkspaceProfile {
  const profile = record(value, PROFILE_KEYS, "profile");
  const schemaVersion = profile.schemaVersion;
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion !== WORKSPACE_PROFILE_SCHEMA_VERSION) {
    fail(`unsupported schema version ${JSON.stringify(schemaVersion)}`);
  }
  const name = optionalText(profile.name, "name");
  const goal = optionalText(profile.goal, "goal");
  return {
    schemaVersion: WORKSPACE_PROFILE_SCHEMA_VERSION,
    business: text(profile.business, "business"),
    ...(name === undefined ? {} : { name }),
    ...(goal === undefined ? {} : { goal }),
    zones: decodeZones(profile.zones),
    skills: stringList(profile.skills, "skills"),
    capabilities: decodeCapabilities(profile.capabilities),
    delivery: decodeDelivery(profile.delivery),
  };
}

function decodeZones(value: unknown): WorkspaceZones {
  if (value === undefined) return EMPTY_WORKSPACE_ZONES;
  const declared = record(value, WORKSPACE_ZONE_KINDS, "zones");
  const zones: Record<WorkspaceZoneKind, readonly string[]> = { ...EMPTY_WORKSPACE_ZONES };
  for (const kind of WORKSPACE_ZONE_KINDS) {
    zones[kind] = stringList(declared[kind], `zones.${kind}`);
  }
  return zones;
}

function decodeCapabilities(value: unknown): WorkspaceCapabilities {
  if (value === undefined) return { mcp: [] };
  const declared = record(value, CAPABILITY_KEYS, "capabilities");
  return { mcp: stringList(declared.mcp, "capabilities.mcp") };
}

function decodeDelivery(value: unknown): WorkspaceDelivery {
  if (value === undefined) return DEFAULT_WORKSPACE_DELIVERY;
  const declared = record(value, DELIVERY_KEYS, "delivery");
  const commentTarget = declared.commentTarget;
  if (commentTarget !== undefined && commentTarget !== "copy" && commentTarget !== "inPlace") {
    fail("delivery.commentTarget");
  }
  return {
    commentTarget: commentTarget ?? DEFAULT_WORKSPACE_DELIVERY.commentTarget,
    outputSuffix:
      optionalText(declared.outputSuffix, "delivery.outputSuffix") ??
      DEFAULT_WORKSPACE_DELIVERY.outputSuffix,
    criteriaFile:
      optionalText(declared.criteriaFile, "delivery.criteriaFile") ??
      DEFAULT_WORKSPACE_DELIVERY.criteriaFile,
  };
}

function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    if (!keys.includes(key)) fail(`unknown field ${label}.${key}`);
  }
  return result;
}

function text(value: unknown, label: string): string {
  const decoded = optionalText(value, label);
  if (decoded === undefined) fail(`${label} must be a non-empty string`);
  return decoded;
}

/** Blank or absent optional strings normalize to `undefined`. */
function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.includes("\0") || value.length > MAX_TEXT_LENGTH) {
    fail(`${label} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function stringList(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) {
    fail(`${label} must be an array`);
  }
  const result = value.map((item) => text(item, `${label}[]`));
  if (new Set(result).size !== result.length) fail(`${label} contains duplicate entries`);
  return result;
}

function fail(reason: string): never {
  throw new Error(`Invalid workspace profile: ${reason}`);
}
