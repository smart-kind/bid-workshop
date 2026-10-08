import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  writeTextFile,
} from "../helpers/electron-app";

const PROFILE_PATH = [".bid", "workspace.json"] as const;

async function launchWithWorkspace(workspacePath: string) {
  return launchDesktop(await makeUserDataDir(), {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
}

async function writeBidSignals(workspacePath: string): Promise<void> {
  await mkdir(join(workspacePath, "招标文件"), { recursive: true });
  await mkdir(join(workspacePath, "产出"), { recursive: true });
  await writeTextFile(join(workspacePath, "评审条件.md"), "# 评审条件\n");
  await writeTextFile(join(workspacePath, "招标文件", "招标书.docx"), "placeholder");
}

async function writeProfile(workspacePath: string, profile: unknown): Promise<void> {
  await mkdir(join(workspacePath, ".bid"), { recursive: true });
  await writeTextFile(join(workspacePath, ...PROFILE_PATH), JSON.stringify(profile, null, 2));
}

test("offers to set up a folder that looks like a bid workspace", async () => {
  test.setTimeout(60_000);
  const workspacePath = await makeWorkspace("business-open-offer");
  await writeBidSignals(workspacePath);
  const harness = await launchWithWorkspace(workspacePath);

  try {
    const window = await harness.firstWindow();
    const bar = window.getByTestId("business-context-bar");
    await expect(bar).toHaveAttribute("data-status", "missing", { timeout: 30_000 });
    await expect(bar).toContainText("This looks like a bid workspace");
    await expect(bar).toContainText("found 评审条件.md");
  } finally {
    await harness.close();
  }
});

test("declining the offer opens the folder as an ordinary workspace", async () => {
  test.setTimeout(60_000);
  const workspacePath = await makeWorkspace("business-open-decline");
  await writeBidSignals(workspacePath);
  const harness = await launchWithWorkspace(workspacePath);

  try {
    const window = await harness.firstWindow();
    const bar = window.getByTestId("business-context-bar");
    await expect(bar).toContainText("This looks like a bid workspace", { timeout: 30_000 });

    await window.getByTestId("business-context-dismiss").click();

    await expect(window.getByTestId("business-context-note")).toHaveText("No business profile");
    await expect(bar).not.toContainText("This looks like a bid workspace");
    expect(existsSync(join(workspacePath, ...PROFILE_PATH))).toBe(false);
  } finally {
    await harness.close();
  }
});

test("accepting the offer writes the recommended profile", async () => {
  test.setTimeout(60_000);
  const workspacePath = await makeWorkspace("business-open-accept");
  await writeBidSignals(workspacePath);
  const harness = await launchWithWorkspace(workspacePath);

  try {
    const window = await harness.firstWindow();
    const bar = window.getByTestId("business-context-bar");
    await expect(bar).toContainText("This looks like a bid workspace", { timeout: 30_000 });

    await window.getByTestId("business-context-initialise").click();

    await expect(bar).toHaveAttribute("data-status", "ok");
    await expect(window.getByTestId("business-context-business")).toHaveText("bid-tender");
    await expect(bar).toContainText("Zoned workspace");
    await expect.poll(() => existsSync(join(workspacePath, ...PROFILE_PATH))).toBe(true);
    const written = JSON.parse(await readFile(join(workspacePath, ...PROFILE_PATH), "utf8")) as {
      business?: string;
    };
    expect(written.business).toBe("bid-tender");
  } finally {
    await harness.close();
  }
});

test("a folder with no bid signals is never asked about", async () => {
  test.setTimeout(60_000);
  const workspacePath = await makeWorkspace("business-open-quiet");
  const harness = await launchWithWorkspace(workspacePath);

  try {
    const window = await harness.firstWindow();
    const bar = window.getByTestId("business-context-bar");
    await expect(bar).toHaveAttribute("data-status", "missing", { timeout: 30_000 });
    await expect(window.getByTestId("business-context-note")).toHaveText("No business profile");
    await expect(window.getByTestId("business-context-initialise")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

test("an unusable profile is reported with its reason and can be rebuilt", async () => {
  test.setTimeout(60_000);
  const workspacePath = await makeWorkspace("business-open-rebuild");
  await writeBidSignals(workspacePath);
  await writeProfile(workspacePath, { schemaVersion: 99, business: "bid-tender" });
  const harness = await launchWithWorkspace(workspacePath);

  try {
    const window = await harness.firstWindow();
    const bar = window.getByTestId("business-context-bar");
    await expect(bar).toHaveAttribute("data-status", "invalid", { timeout: 30_000 });
    await expect(window.getByTestId("business-context-reason")).toContainText(
      "unsupported schema version",
    );

    await window.getByTestId("business-context-rebuild").click();

    await expect(bar).toHaveAttribute("data-status", "ok");
    await expect(window.getByTestId("business-context-business")).toHaveText("bid-tender");
    await expect
      .poll(async () =>
        (await readdir(join(workspacePath, ".bid"))).some((name) =>
          name.startsWith("workspace.json.corrupt-"),
        ),
      )
      .toBe(true);
  } finally {
    await harness.close();
  }
});
