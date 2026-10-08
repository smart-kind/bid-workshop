import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunSkillRef } from "./ledger";

/**
 * Which skills a run rested on, and what they contained.
 *
 * The workspace profile's `skills` field is the enable-list. A name in that list
 * with no skill behind it is reported, never dropped: silently running without a
 * criterion the workspace asked for would make the review look complete when it
 * is not.
 */

export const SKILLS_DIRECTORY = ".agents/skills";
export const SKILL_FILE = "SKILL.md";

export interface ResolvedRunSkills {
  readonly skills: readonly RunSkillRef[];
  /** Names the profile asked for that are not in the workspace. */
  readonly missing: readonly string[];
}

/** The enable-list from the workspace profile, as far as it can be trusted. */
export async function readProfileSkills(workspacePath: string): Promise<readonly string[]> {
  try {
    const raw = await readFile(join(workspacePath, ".bid", "workspace.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const skills = (parsed as { skills?: unknown }).skills;
    if (!Array.isArray(skills)) return [];
    return skills.filter((name): name is string => typeof name === "string" && name.trim() !== "");
  } catch {
    return [];
  }
}

/** Resolve the enable-list against what is actually in the workspace. */
export async function resolveRunSkills(input: {
  readonly workspacePath: string;
  readonly names?: readonly string[];
}): Promise<ResolvedRunSkills> {
  const names = input.names ?? (await readProfileSkills(input.workspacePath));
  const skills: RunSkillRef[] = [];
  const missing: string[] = [];
  for (const name of names) {
    try {
      const bytes = await readFile(join(input.workspacePath, SKILLS_DIRECTORY, name, SKILL_FILE));
      skills.push({
        id: name,
        fingerprint: createHash("sha256").update(bytes).digest("hex").slice(0, 16),
      });
    } catch {
      missing.push(name);
    }
  }
  return { skills, missing };
}

/** What a run says about the skills it used, for the header and for the user. */
export function describeRunSkills(resolved: ResolvedRunSkills): string {
  const used = resolved.skills.map((skill) => skill.id);
  const parts: string[] = [];
  if (used.length > 0) parts.push(`本次使用技能：${used.join("、")}`);
  if (resolved.missing.length > 0) {
    parts.push(`以下技能在档案里启用但工作区中不存在：${resolved.missing.join("、")}`);
  }
  return parts.join("；");
}
