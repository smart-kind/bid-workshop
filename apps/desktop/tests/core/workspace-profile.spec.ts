import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  selectSidePanel,
  waitForWorkspaceByPath,
  writeTextFile,
} from "../helpers/electron-app";

/** N1 exit: the profile's three opening paths, the write refusal and the marking. */

const PROFILE = [".bid", "workspace.json"] as const;

async function writeProfile(workspacePath: string, contents: string): Promise<void> {
  await mkdir(join(workspacePath, ".bid"), { recursive: true });
  await writeTextFile(join(workspacePath, ...PROFILE), contents);
}

async function openWorkspace(workspacePath: string) {
  const harness = await launchDesktop(await makeUserDataDir(), {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  const window = await harness.firstWindow();
  const workspace = await waitForWorkspaceByPath(window, workspacePath);
  return { harness, window, workspaceId: workspace.id };
}

async function writeViaIpc(
  window: Page,
  input: { workspaceId: string; filePath: string; contents: string },
): Promise<void> {
  await window.evaluate(async (request) => {
    const app = globalThis.window.piApp;
    if (!app) throw new Error("piApp IPC bridge is unavailable");
    await app.writeWorkspaceFile(request);
  }, input);
}

async function zonedWorkspace(name: string) {
  const workspacePath = await makeWorkspace(name);
  for (const directory of ["招标文件", "产出"]) {
    await mkdir(join(workspacePath, directory), { recursive: true });
  }
  await writeFile(join(workspacePath, "招标文件", "招标书.txt"), "material\n", "utf8");
  await writeProfile(
    workspacePath,
    JSON.stringify({
      schemaVersion: 1,
      business: "bid-tender",
      zones: { material: ["招标文件"], output: ["产出"] },
    }),
  );
  return workspacePath;
}

test("a valid profile applies to the workspace, the tree and the write path", async () => {
  test.setTimeout(60_000);
  const workspacePath = await zonedWorkspace("profile-valid");
  const { harness, window, workspaceId } = await openWorkspace(workspacePath);

  try {
    const bar = window.getByTestId("business-context-bar");
    await expect(bar).toHaveAttribute("data-status", "ok", { timeout: 30_000 });
    await expect(window.getByTestId("business-context-business")).toHaveText("bid-tender");
    await expect(window.locator('[data-zone-path="招标文件"]')).toHaveAttribute(
      "data-zone-read-only",
      "true",
    );

    await createNamedThread(window, "N1 valid profile");
    await selectSidePanel(window, "Files");
    await window.locator(".file-workbench__tree-row--dir", { hasText: "招标文件" }).click();
    await expect(
      window
        .locator('[data-file-path="招标文件/招标书.txt"]')
        .getByTestId("file-workbench-read-only"),
    ).toBeVisible();

    // Bypassing the UI: the refusal lives in main, not in a disabled control.
    await expect(
      writeViaIpc(window, { workspaceId, filePath: "招标文件/招标书.txt", contents: "rewritten" }),
    ).rejects.toThrow(/read-only material zone/);
    expect(await readFile(join(workspacePath, "招标文件", "招标书.txt"), "utf8")).toBe(
      "material\n",
    );

    await writeViaIpc(window, { workspaceId, filePath: "产出/定稿.txt", contents: "ok" });
    expect(await readFile(join(workspacePath, "产出", "定稿.txt"), "utf8")).toBe("ok");
  } finally {
    await harness.close();
  }
});

test("a folder with no profile still opens as an ordinary workspace", async () => {
  test.setTimeout(60_000);
  const workspacePath = await makeWorkspace("profile-missing");
  const { harness, window } = await openWorkspace(workspacePath);

  try {
    await expect(window.getByTestId("business-context-bar")).toHaveAttribute(
      "data-status",
      "missing",
      { timeout: 30_000 },
    );
    await expect(window.getByTestId("business-context-note")).toHaveText("No business profile");
    await createNamedThread(window, "N1 missing profile");
    await expect(window.getByTestId("file-workbench")).toHaveCount(0);
    expect(existsSync(join(workspacePath, ...PROFILE))).toBe(false);
  } finally {
    await harness.close();
  }
});

test("an unparsable profile is reported without blocking the folder or losing its bytes", async () => {
  test.setTimeout(60_000);
  const workspacePath = await makeWorkspace("profile-damaged");
  const original = "{ not json at all";
  await writeProfile(workspacePath, original);
  const { harness, window } = await openWorkspace(workspacePath);

  try {
    const bar = window.getByTestId("business-context-bar");
    await expect(bar).toHaveAttribute("data-status", "invalid", { timeout: 30_000 });
    await expect(window.getByTestId("business-context-reason")).toContainText(
      "档案无法解析，且没有可用的备份",
    );

    await createNamedThread(window, "N1 damaged profile");
    await expect(window.getByTestId("file-workbench")).toHaveCount(0);

    expect(await readFile(join(workspacePath, ...PROFILE), "utf8")).toBe(original);
  } finally {
    await harness.close();
  }
});
