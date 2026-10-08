import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  EMPTY_WORKSPACE_ZONES,
  WORKSPACE_PROFILE_SCHEMA_VERSION,
  WORKSPACE_ZONE_KINDS,
  type WorkspaceProfile,
  type WorkspaceZoneKind,
  type WorkspaceZones,
} from "../../contracts/business-workspace";

/** The design's recommended layout (docs/business-workspace-design.md §5.1). */
const RECOMMENDED_ZONE_DIRECTORIES: Readonly<Record<WorkspaceZoneKind, string>> = {
  reference: "公司资料",
  material: "招标文件",
  output: "产出",
  feedback: "意见",
};

const CRITERIA_BASENAMES = ["评审条件", "评审标准", "评分标准", "评分办法", "资格条件"];
const CRITERIA_EXTENSIONS = new Set([".md", ".txt", ".docx"]);

const SKIPPED_DIRECTORIES = new Set([".git", ".pi", ".bid", "node_modules", "dist", "out"]);
const MAX_DEPTH = 3;
const MAX_DOCUMENTS = 20;

/**
 * What a plain folder looks like when it might be a bid workspace, plus the
 * profile we would write if the user accepts the recommendation. Only signals
 * are reported: nothing here writes or moves anything.
 */
export interface BusinessWorkspaceProbe {
  /** Workspace-relative `.docx` paths, capped; these are the review candidates. */
  readonly documents: readonly string[];
  /** Root-level criteria file (e.g. `评审条件.md`) when one is present. */
  readonly criteriaFile?: string;
  /** Recommended-layout directories that actually exist, in zone order. */
  readonly zoneDirectories: readonly string[];
  /** False when nothing suggests a bid workspace; then we do not ask. */
  readonly looksLikeBusiness: boolean;
  readonly proposedProfile: WorkspaceProfile;
}

export async function probeBusinessWorkspace(
  workspacePath: string,
): Promise<BusinessWorkspaceProbe> {
  const rootEntries = await readEntryNames(workspacePath);
  const documents: string[] = [];
  await collectDocuments(workspacePath, "", 0, documents);

  const directories = new Set(
    rootEntries.filter((entry) => entry.isDirectory).map((entry) => entry.name),
  );
  const zones: Record<WorkspaceZoneKind, readonly string[]> = { ...EMPTY_WORKSPACE_ZONES };
  const zoneDirectories: string[] = [];
  for (const kind of WORKSPACE_ZONE_KINDS) {
    const directory = RECOMMENDED_ZONE_DIRECTORIES[kind];
    if (!directories.has(directory)) continue;
    zones[kind] = [directory];
    zoneDirectories.push(directory);
  }

  const criteriaFile = rootEntries
    .filter((entry) => !entry.isDirectory)
    .map((entry) => entry.name)
    .find(isCriteriaFile);

  return {
    documents,
    ...(criteriaFile === undefined ? {} : { criteriaFile }),
    zoneDirectories,
    looksLikeBusiness: documents.length > 0 || criteriaFile !== undefined,
    proposedProfile: {
      schemaVersion: WORKSPACE_PROFILE_SCHEMA_VERSION,
      business: "bid-tender",
      zones: zones as WorkspaceZones,
      skills: [],
      capabilities: { mcp: [] },
      delivery: {
        commentTarget: "copy",
        outputSuffix: "-批注",
        criteriaFile: criteriaFile ?? "评审条件.md",
      },
    },
  };
}

function isCriteriaFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  const extension = name.slice(dot).toLowerCase();
  return CRITERIA_EXTENSIONS.has(extension) && CRITERIA_BASENAMES.includes(name.slice(0, dot));
}

async function collectDocuments(
  workspacePath: string,
  relativeDirectory: string,
  depth: number,
  documents: string[],
): Promise<void> {
  for (const entry of await readEntryNames(join(workspacePath, relativeDirectory))) {
    if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    if (entry.isDirectory) {
      if (depth < MAX_DEPTH) {
        await collectDocuments(workspacePath, relative, depth + 1, documents);
      }
      continue;
    }
    if (documents.length < MAX_DOCUMENTS && entry.name.toLowerCase().endsWith(".docx")) {
      documents.push(relative);
    }
  }
}

async function readEntryNames(
  directory: string,
): Promise<readonly { readonly name: string; readonly isDirectory: boolean }[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
