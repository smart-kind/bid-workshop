import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { describeRunSkills, readProfileSkills, resolveRunSkills } from "../skills-index";

/** T-23: the enable-list drives the run header, and a missing skill is named. */

async function workspace(profile: unknown, skills: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "bid-skills-"));
  await mkdir(join(root, ".bid"), { recursive: true });
  await writeFile(join(root, ".bid", "workspace.json"), JSON.stringify(profile), "utf8");
  for (const [name, body] of Object.entries(skills)) {
    await mkdir(join(root, ".agents", "skills", name), { recursive: true });
    await writeFile(join(root, ".agents", "skills", name, "SKILL.md"), body, "utf8");
  }
  return root;
}

test("resolves the profile's list against what the workspace has", async () => {
  const root = await workspace(
    { schemaVersion: 1, business: "bid-tender", skills: ["a", "gone"] },
    {
      a: "# A\n",
    },
  );

  expect(await readProfileSkills(root)).toEqual(["a", "gone"]);
  const resolved = await resolveRunSkills({ workspacePath: root });

  expect(resolved.skills.map((skill) => skill.id)).toEqual(["a"]);
  expect(resolved.skills[0]?.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  // A name with no skill behind it is named, not dropped.
  expect(resolved.missing).toEqual(["gone"]);
  expect(describeRunSkills(resolved)).toContain("本次使用技能：a");
  expect(describeRunSkills(resolved)).toContain("工作区中不存在：gone");
});

test("the fingerprint follows the skill's content", async () => {
  const first = await resolveRunSkills({
    workspacePath: await workspace({ schemaVersion: 1, skills: ["a"] }, { a: "# A\n" }),
  });
  const second = await resolveRunSkills({
    workspacePath: await workspace({ schemaVersion: 1, skills: ["a"] }, { a: "# A changed\n" }),
  });

  expect(first.skills[0]?.fingerprint).not.toBe(second.skills[0]?.fingerprint);
});

test("a workspace with no profile, or an unreadable one, asks for nothing", async () => {
  const empty = await mkdtemp(join(tmpdir(), "bid-skills-empty-"));
  expect(await readProfileSkills(empty)).toEqual([]);
  expect(await resolveRunSkills({ workspacePath: empty })).toEqual({ skills: [], missing: [] });

  const broken = await mkdtemp(join(tmpdir(), "bid-skills-broken-"));
  await mkdir(join(broken, ".bid"), { recursive: true });
  await writeFile(join(broken, ".bid", "workspace.json"), "{ not json", "utf8");
  expect(await readProfileSkills(broken)).toEqual([]);
});
