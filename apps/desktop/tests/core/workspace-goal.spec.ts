import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  writeTextFile,
} from "../helpers/electron-app";

/** T-21: the review's goal is declared, visible, editable, and it persists. */

const PROFILE = [".bid", "workspace.json"] as const;

async function writeProfile(workspacePath: string, profile: unknown): Promise<void> {
  await mkdir(join(workspacePath, ".bid"), { recursive: true });
  await writeTextFile(join(workspacePath, ...PROFILE), JSON.stringify(profile, null, 2));
}

async function launchWith(workspacePath: string, userDataDir: string) {
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  const window = await harness.firstWindow();
  return { harness, window };
}

test("shows the goal the workspace declares", async () => {
  test.setTimeout(60_000);
  const workspacePath = await makeWorkspace("goal-declared");
  await writeProfile(workspacePath, {
    schemaVersion: 1,
    business: "bid-tender",
    goal: "按评审条件审查产出目录的投标文件，逐条出批注",
  });
  const { harness, window } = await launchWith(workspacePath, await makeUserDataDir());

  try {
    await createNamedThread(window, "Goal session");
    const bar = window.getByTestId("business-context-bar");
    await expect(bar).toHaveAttribute("data-status", "ok", { timeout: 30_000 });
    await expect(window.getByTestId("business-context-goal")).toHaveText(
      "按评审条件审查产出目录的投标文件，逐条出批注",
    );
  } finally {
    await harness.close();
  }
});

test("declaring a goal writes it and it survives a restart", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("goal-edited");
  await writeProfile(workspacePath, { schemaVersion: 1, business: "bid-tender" });

  const first = await launchWith(workspacePath, userDataDir);
  try {
    await createNamedThread(first.window, "Goal edit session");
    const bar = first.window.getByTestId("business-context-bar");
    await expect(bar).toHaveAttribute("data-status", "ok", { timeout: 30_000 });
    // Nothing declared yet, and the bar says so instead of looking empty.
    await expect(first.window.getByTestId("business-context-goal")).toHaveText("未声明目标");

    await first.window.getByTestId("business-context-goal-edit").click();
    await first.window.getByTestId("business-context-goal-input").fill("先审资质，再审报价一致性");
    await first.window.getByTestId("business-context-goal-save").click();

    await expect(first.window.getByTestId("business-context-goal")).toHaveText(
      "先审资质，再审报价一致性",
    );
    const written = JSON.parse(await readFile(join(workspacePath, ...PROFILE), "utf8")) as {
      goal?: string;
      business?: string;
    };
    expect(written.goal).toBe("先审资质，再审报价一致性");
    // Writing the goal kept the rest of the profile intact.
    expect(written.business).toBe("bid-tender");
  } finally {
    await first.harness.close();
  }

  const second = await launchWith(workspacePath, userDataDir);
  try {
    const bar = second.window.getByTestId("business-context-bar");
    await expect(bar).toHaveAttribute("data-status", "ok", { timeout: 30_000 });
    await expect(second.window.getByTestId("business-context-goal")).toHaveText(
      "先审资质，再审报价一致性",
    );
  } finally {
    await second.harness.close();
  }
});
