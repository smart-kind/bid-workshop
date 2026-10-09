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

/** ASCII so the assertion cannot be satisfied by the document's own Chinese text. */
const MARKER = "ShellSaveProbe2026";

/** The hosted document view is a WebContentsView; Playwright exposes it as its own page. */
async function waitForDocumentView(app: ElectronApplication, timeoutMs = 30_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = app.windows().find((candidate) => candidate.url().startsWith("bid-docs://"));
    if (page) return page;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("No document view appeared");
}

/**
 * Delivers a menu command the way the native File menu does: main pushes it to
 * the hosted view and the preload hands it to the editor's menu handler.
 *
 * The native menu item's own click handler is not exercised here — background
 * test windows never receive native menu accelerators. That handler is a
 * five-line route into this same push.
 */
async function pressDocumentMenuCommand(app: ElectronApplication, command: string): Promise<void> {
  await app.evaluate(({ webContents }, wanted) => {
    const target = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith("bid-docs://"));
    if (!target) throw new Error("No document view is open");
    target.send("bid-docs:menu-command", wanted);
  }, command);
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

test("an edit saved from the document view reaches the file and survives a reopen", async () => {
  test.setTimeout(180_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("document-edit-save-workspace");
  const documentPath = join(workspacePath, SAMPLE_FILE);
  await copyFile(sampleBidSource, documentPath);
  const before = await sha256Of(documentPath);
  expect(await partOfDocx(documentPath, "word/document.xml")).not.toContain(MARKER);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Document edit session");
    await selectSidePanel(window, "Files");

    const tree = window.getByTestId("file-workbench-tree");
    const sampleRow = tree.locator(
      `.file-workbench__tree-row--file[data-file-path="${SAMPLE_FILE}"]`,
    );
    await expect(sampleRow).toBeVisible({ timeout: 15_000 });
    await sampleRow.click();

    const documentView = await waitForDocumentView(harness.electronApp);
    await expect(documentView.locator(".doc-page")).toBeVisible({ timeout: 30_000 });
    const documentBody = documentView.locator("body");
    await expect(documentBody).toContainText(REAL_HEADING, { timeout: 30_000 });

    // --- a real edit: put the caret in the document and type into it ---
    await documentView.locator(".doc-page").getByText(REAL_HEADING).first().click();
    await documentView.keyboard.press("End");
    await documentView.keyboard.type(` ${MARKER}`);
    await expect(documentBody).toContainText(MARKER);

    // --- save, exactly as File > Save does ---
    await pressDocumentMenuCommand(harness.electronApp, "save");

    // --- the change is in the file, not only in the editor ---
    await expect.poll(async () => sha256Of(documentPath), { timeout: 30_000 }).not.toBe(before);
    expect(await partOfDocx(documentPath, "word/document.xml")).toContain(MARKER);

    // --- and it comes back: the saved bytes parse and render on a reopen ---
    await tree.locator('.file-workbench__tree-row--file[data-file-path="README.md"]').click();
    await sampleRow.click();
    const reopened = await waitForDocumentView(harness.electronApp);
    await expect(reopened.locator("body")).toContainText(MARKER, { timeout: 30_000 });
  } finally {
    await harness.close();
  }
});
