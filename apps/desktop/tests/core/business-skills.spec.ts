import { cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

/** T-22: the business skills land as workspace-scoped skills and are usable. */

const repoRoot = resolve(__dirname, "../../../..");
const SKILLS = [
  "bid-qualification",
  "bid-pricing-consistency",
  "bid-technical-plan",
  "bid-format-compliance",
];
const LANDED = join(repoRoot, "workspaces", "bid-sample", ".agents", "skills");

test("the business skills show as workspace skills and are usable as slash commands", async () => {
  test.setTimeout(60_000);
  const workspacePath = await makeWorkspace("business-skills-workspace");
  await cp(LANDED, join(workspacePath, ".agents", "skills"), { recursive: true });

  const harness = await launchDesktop(await makeUserDataDir(), {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Business skills session");

    await window.getByRole("button", { name: "Skills", exact: true }).click();
    const surface = window.getByTestId("skills-surface");
    await expect(surface).toBeVisible();

    // Workspace scope, because they live in the workspace's own .agents/skills.
    // The listed name is the directory id, title-cased.
    const list = window.getByTestId("skills-list");
    await expect(list.getByRole("heading", { name: /Workspace/ })).toBeVisible();
    for (const name of [
      "Bid Qualification",
      "Bid Pricing Consistency",
      "Bid Technical Plan",
      "Bid Format Compliance",
    ]) {
      await expect(list.getByRole("switch", { name: `Enable ${name}` })).toBeVisible();
    }

    // Each one is reachable by its slash command.
    await window.getByRole("button", { name: /Bid Qualification/ }).click();
    await expect(window.locator(".skill-detail")).toContainText("/skill:bid-qualification");
    await window.getByRole("button", { name: "Try", exact: true }).click();
    await expect(window.getByTestId("composer")).toHaveValue("/skill:bid-qualification ");
  } finally {
    await harness.close();
  }
});
