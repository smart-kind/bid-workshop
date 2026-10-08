import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  writeTextFile,
} from "../helpers/electron-app";

async function writeProfile(workspacePath: string, profile: unknown): Promise<void> {
  await mkdir(join(workspacePath, ".bid"), { recursive: true });
  await writeTextFile(
    join(workspacePath, ".bid", "workspace.json"),
    JSON.stringify(profile, null, 2),
  );
}

async function launchWithWorkspace(workspacePath: string) {
  return launchDesktop(await makeUserDataDir(), {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
}

test("shows the business type of a workspace that declares a profile", async () => {
  test.setTimeout(60_000);
  const workspacePath = await makeWorkspace("business-context-zoned");
  await writeProfile(workspacePath, {
    schemaVersion: 1,
    business: "bid-tender",
    zones: { material: ["招标文件"], output: ["产出"] },
  });
  const harness = await launchWithWorkspace(workspacePath);

  try {
    const window = await harness.firstWindow();
    await expect(window.getByTestId("business-context-bar")).toHaveAttribute("data-status", "ok", {
      timeout: 30_000,
    });
    await expect(window.getByTestId("business-context-business")).toHaveText("bid-tender");
    await expect(window.getByTestId("business-context-bar")).toContainText("Zoned workspace");
  } finally {
    await harness.close();
  }
});

test("reports a flat workspace as having no zones declared", async () => {
  test.setTimeout(60_000);
  const workspacePath = await makeWorkspace("business-context-flat");
  await writeProfile(workspacePath, { schemaVersion: 1, business: "bid-tender" });
  const harness = await launchWithWorkspace(workspacePath);

  try {
    const window = await harness.firstWindow();
    const bar = window.getByTestId("business-context-bar");
    await expect(bar).toHaveAttribute("data-status", "ok", { timeout: 30_000 });
    await expect(bar).toContainText("No zones declared");
  } finally {
    await harness.close();
  }
});

test("reports a missing profile without hiding the workspace", async () => {
  test.setTimeout(60_000);
  const workspacePath = await makeWorkspace("business-context-missing");
  const harness = await launchWithWorkspace(workspacePath);

  try {
    const window = await harness.firstWindow();
    const bar = window.getByTestId("business-context-bar");
    await expect(bar).toHaveAttribute("data-status", "missing", { timeout: 30_000 });
    await expect(bar).toContainText("No business profile");
  } finally {
    await harness.close();
  }
});

test("reports an unusable profile instead of failing to open the folder", async () => {
  test.setTimeout(60_000);
  const workspacePath = await makeWorkspace("business-context-invalid");
  await writeProfile(workspacePath, { schemaVersion: 99, business: "bid-tender" });
  const harness = await launchWithWorkspace(workspacePath);

  try {
    const window = await harness.firstWindow();
    const bar = window.getByTestId("business-context-bar");
    await expect(bar).toHaveAttribute("data-status", "invalid", { timeout: 30_000 });
    await expect(bar).toContainText("Business profile invalid");
  } finally {
    await harness.close();
  }
});
