import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
  writeTextFile,
} from "../helpers/electron-app";

/** A direct IPC write, as an extension or a renderer could issue it — no UI. */
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

async function openZonedWorkspace(name: string) {
  const workspacePath = await makeWorkspace(name);
  await mkdir(join(workspacePath, "招标文件"), { recursive: true });
  await mkdir(join(workspacePath, "产出"), { recursive: true });
  await mkdir(join(workspacePath, ".bid"), { recursive: true });
  await writeTextFile(
    join(workspacePath, ".bid", "workspace.json"),
    JSON.stringify({
      schemaVersion: 1,
      business: "bid-tender",
      zones: { material: ["招标文件"], output: ["产出"] },
    }),
  );
  const harness = await launchDesktop(await makeUserDataDir(), {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  const window = await harness.firstWindow();
  const workspace = await waitForWorkspaceByPath(window, workspacePath);
  return { harness, window, workspacePath, workspaceId: workspace.id };
}

test("refuses a write into a read-only zone, even straight from IPC", async () => {
  test.setTimeout(60_000);
  const { harness, window, workspacePath, workspaceId } =
    await openZonedWorkspace("write-gate-readonly");

  try {
    const target = join(workspacePath, "招标文件", "招标书.txt");
    await expect(
      writeViaIpc(window, {
        workspaceId,
        filePath: "招标文件/招标书.txt",
        contents: "rewritten",
      }),
    ).rejects.toThrow(/read-only material zone/);
    expect(existsSync(target)).toBe(false);
  } finally {
    await harness.close();
  }
});

test("allows a write into a writable zone", async () => {
  test.setTimeout(60_000);
  const { harness, window, workspacePath, workspaceId } =
    await openZonedWorkspace("write-gate-output");

  try {
    await writeViaIpc(window, {
      workspaceId,
      filePath: "产出/投标文件-批注.txt",
      contents: "written",
    });
    expect(await readFile(join(workspacePath, "产出", "投标文件-批注.txt"), "utf8")).toBe(
      "written",
    );
  } finally {
    await harness.close();
  }
});

test("allows an undeclared path and refuses one that leaves the workspace", async () => {
  test.setTimeout(60_000);
  const { harness, window, workspacePath, workspaceId } =
    await openZonedWorkspace("write-gate-undeclared");

  try {
    await writeViaIpc(window, { workspaceId, filePath: "随手记.txt", contents: "note" });
    expect(await readFile(join(workspacePath, "随手记.txt"), "utf8")).toBe("note");

    await expect(
      writeViaIpc(window, { workspaceId, filePath: "../escape.txt", contents: "nope" }),
    ).rejects.toThrow(/outside the workspace/);
    expect(existsSync(join(workspacePath, "..", "escape.txt"))).toBe(false);
  } finally {
    await harness.close();
  }
});

test("a workspace that declares no zones accepts the same write", async () => {
  test.setTimeout(60_000);
  const workspacePath = await makeWorkspace("write-gate-flat");
  await mkdir(join(workspacePath, "招标文件"), { recursive: true });
  await mkdir(join(workspacePath, ".bid"), { recursive: true });
  await writeTextFile(
    join(workspacePath, ".bid", "workspace.json"),
    JSON.stringify({ schemaVersion: 1, business: "bid-tender" }),
  );
  const harness = await launchDesktop(await makeUserDataDir(), {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const workspace = await waitForWorkspaceByPath(window, workspacePath);
    await writeViaIpc(window, {
      workspaceId: workspace.id,
      filePath: "招标文件/招标书.txt",
      contents: "allowed",
    });
    expect(await readFile(join(workspacePath, "招标文件", "招标书.txt"), "utf8")).toBe("allowed");
  } finally {
    await harness.close();
  }
});
