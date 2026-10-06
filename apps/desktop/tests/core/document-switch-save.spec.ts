import { createHash } from "node:crypto";
import { copyFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import JSZip from "jszip";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  selectSidePanel,
} from "../helpers/electron-app";

const repoRoot = resolve(__dirname, "../../../..");
const SAMPLE_FILE = "投标文件-某软件科技.docx";
const sampleBidSource = join(repoRoot, "workspaces", "bid-sample", SAMPLE_FILE);
const REAL_HEADING = "投标人基本情况";
const MARKER = "ShellSwitchProbe2026";

async function waitForDocumentView(app: ElectronApplication, timeoutMs = 30_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = app.windows().find((candidate) => candidate.url().startsWith("bid-docs://"));
    if (page) return page;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("No document view appeared");
}

function documentViewBounds(app: ElectronApplication): Promise<{ width: number } | null> {
  return app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return null;
    for (const child of window.contentView.children) {
      const view = child as unknown as {
        readonly webContents?: { getURL(): string };
        getBounds(): { width: number };
      };
      if (view.webContents?.getURL().startsWith("bid-docs://")) {
        return view.getBounds();
      }
    }
    return null;
  });
}

async function partOfDocx(filePath: string, part: string): Promise<string> {
  const archive = await JSZip.loadAsync(await readFile(filePath));
  const entry = archive.file(part);
  if (!entry) throw new Error(`${part} is missing from ${filePath}`);
  return entry.async("string");
}

async function sha256Of(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

test("switching away from a document saves it before the view is torn down", async () => {
  test.setTimeout(180_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("document-switch-save-workspace");
  const documentPath = join(workspacePath, SAMPLE_FILE);
  await copyFile(sampleBidSource, documentPath);
  const before = await sha256Of(documentPath);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Document switch session");
    await selectSidePanel(window, "Files");

    const tree = window.getByTestId("file-workbench-tree");
    const sampleRow = tree.locator(
      `.file-workbench__tree-row--file[data-file-path="${SAMPLE_FILE}"]`,
    );
    await expect(sampleRow).toBeVisible({ timeout: 15_000 });
    await sampleRow.click();

    const documentView = await waitForDocumentView(harness.electronApp);
    await expect(documentView.locator(".doc-page")).toBeVisible({ timeout: 30_000 });
    await expect(documentView.locator("body")).toContainText(REAL_HEADING, { timeout: 30_000 });

    await documentView.locator(".doc-page").getByText(REAL_HEADING).first().click();
    await documentView.keyboard.press("End");
    await documentView.keyboard.type(` ${MARKER}`);
    await expect(documentView.locator("body")).toContainText(MARKER);

    // Nothing has saved this yet: the edit only exists in the renderer, so what
    // follows cannot pass by accident.
    expect(await sha256Of(documentPath)).toBe(before);

    // --- leaving the document is what persists it ---
    await tree.locator('.file-workbench__tree-row--file[data-file-path="README.md"]').click();

    await expect.poll(async () => sha256Of(documentPath), { timeout: 30_000 }).not.toBe(before);
    expect(await partOfDocx(documentPath, "word/document.xml")).toContain(MARKER);

    // The switch itself still completed: the guarded save must not wedge the pane.
    await expect
      .poll(async () => (await documentViewBounds(harness.electronApp))?.width ?? -1)
      .toBe(0);
  } finally {
    await harness.close();
  }
});
