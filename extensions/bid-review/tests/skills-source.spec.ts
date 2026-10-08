import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/**
 * T-22: the four business skills ship as templates and land in the sample
 * workspace. The two copies are the same bytes, so they cannot drift apart.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const templateRoot = `${packageRoot}skills`;
const sampleRoot = `${repoRoot}workspaces/bid-sample/.agents/skills`;

const EXPECTED = [
  "bid-qualification",
  "bid-pricing-consistency",
  "bid-technical-plan",
  "bid-format-compliance",
];

test("ships one skill per criterion family", async () => {
  const entries = (await readdir(templateRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  expect(entries).toEqual([...EXPECTED].sort());
});

test("each skill says how to check, where the edges are, and what to report", async () => {
  for (const id of EXPECTED) {
    const body = await readFile(`${templateRoot}/${id}/SKILL.md`, "utf8");
    expect(body).toMatch(/^# /m);
    expect(body).toContain("## 怎么核对");
    expect(body).toContain("## 边界与反例");
    expect(body).toContain("## 输出要求");
    // It must not restate the requirements: those live in the criteria file.
    expect(body).toContain("判据文件");
    expect(body).toContain("评审条件.md");
  }
});

test("the sample workspace's copies are byte-identical to the templates", async () => {
  for (const id of EXPECTED) {
    const template = await readFile(`${templateRoot}/${id}/SKILL.md`, "utf8");
    const landed = await readFile(`${sampleRoot}/${id}/SKILL.md`, "utf8");
    expect(landed).toBe(template);
  }
});
