import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  selectSidePanel,
} from "../helpers/electron-app";

async function openZonedWorkspace() {
  const workspacePath = await makeWorkspace("read-only-marking");
  for (const directory of ["招标文件", "产出"]) {
    await mkdir(join(workspacePath, directory), { recursive: true });
  }
  await writeFile(join(workspacePath, "招标文件", "招标书.txt"), "material\n", "utf8");
  await writeFile(join(workspacePath, "产出", "产出说明.txt"), "output\n", "utf8");
  await writeFile(join(workspacePath, "随手记.txt"), "note\n", "utf8");
  await mkdir(join(workspacePath, ".bid"), { recursive: true });
  await writeFile(
    join(workspacePath, ".bid", "workspace.json"),
    JSON.stringify({
      schemaVersion: 1,
      business: "bid-tender",
      zones: { material: ["招标文件"], output: ["产出"] },
    }),
    "utf8",
  );
  const harness = await launchDesktop(await makeUserDataDir(), {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  const window = await harness.firstWindow();
  return { harness, window };
}

test("marks files in read-only zones and leaves the writable ones alone", async ({}, testInfo) => {
  test.setTimeout(60_000);
  const { harness, window } = await openZonedWorkspace();

  try {
    await createNamedThread(window, "Read-only marking");
    await selectSidePanel(window, "Files");
    await window.locator(".file-workbench__tree-row--dir", { hasText: "招标文件" }).click();
    await window.locator(".file-workbench__tree-row--dir", { hasText: "产出" }).click();

    const materialRow = window.locator('[data-file-path="招标文件/招标书.txt"]');
    await expect(materialRow).toHaveAttribute("data-read-only", "true");
    await expect(materialRow.getByTestId("file-workbench-read-only")).toBeVisible();

    const outputRow = window.locator('[data-file-path="产出/产出说明.txt"]');
    await expect(outputRow).toHaveCount(1);
    await expect(outputRow).not.toHaveAttribute("data-read-only", "true");
    await expect(outputRow.getByTestId("file-workbench-read-only")).toHaveCount(0);

    const undeclaredRow = window.locator('[data-file-path="随手记.txt"]');
    await expect(undeclaredRow).toHaveCount(1);
    await expect(undeclaredRow.getByTestId("file-workbench-read-only")).toHaveCount(0);

    await window.screenshot({ path: testInfo.outputPath("read-only-marking.png") });
  } finally {
    await harness.close();
  }
});

test("the context bar lists each declared zone with its kind", async () => {
  test.setTimeout(60_000);
  const { harness, window } = await openZonedWorkspace();

  try {
    await createNamedThread(window, "Zone overview");
    const bar = window.getByTestId("business-context-bar");
    await expect(bar).toHaveAttribute("data-status", "ok", { timeout: 30_000 });
    await expect(window.getByTestId("business-context-zone")).toHaveCount(2);
    await expect(window.locator('[data-zone-path="招标文件"]')).toHaveAttribute(
      "data-zone-read-only",
      "true",
    );
    await expect(window.locator('[data-zone-path="产出"]')).toHaveAttribute(
      "data-zone-read-only",
      "false",
    );
  } finally {
    await harness.close();
  }
});

test("clicking a zone opens the Files pane at that directory", async () => {
  test.setTimeout(60_000);
  const { harness, window } = await openZonedWorkspace();

  try {
    await createNamedThread(window, "Zone locate");
    await expect(window.getByTestId("business-context-bar")).toHaveAttribute("data-status", "ok", {
      timeout: 30_000,
    });

    await window.locator('[data-zone-path="招标文件"]').click();

    await expect(window.getByTestId("file-explorer")).toBeVisible();
    await expect(window.locator('[data-file-path="招标文件/招标书.txt"]')).toHaveCount(1);
  } finally {
    await harness.close();
  }
});
