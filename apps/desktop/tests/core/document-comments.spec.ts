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

/** ASCII so nothing in the document's own Chinese text can satisfy the assertion. */
const COMMENT_TEXT = "ShellCommentProbe2026";

async function waitForDocumentView(app: ElectronApplication, timeoutMs = 30_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = app.windows().find((candidate) => candidate.url().startsWith("bid-docs://"));
    if (page) return page;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("No document view appeared");
}

/** The way the native File menu reaches the editor; see document-edit-save.spec.ts. */
async function pressDocumentMenuCommand(app: ElectronApplication, command: string): Promise<void> {
  await app.evaluate(({ webContents }, wanted) => {
    const target = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith("bid-docs://"));
    if (!target) throw new Error("No document view is open");
    target.send("bid-docs:menu-command", wanted);
  }, command);
}

/** The named part of the docx, or "" when the archive has no such part yet. */
async function partOrEmpty(filePath: string, part: string): Promise<string> {
  const archive = await JSZip.loadAsync(await readFile(filePath));
  const entry = archive.file(part);
  return entry ? entry.async("string") : "";
}

test("a comment written in the document view lands in the file as a Word comment", async () => {
  test.setTimeout(180_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("document-comments-workspace");
  const documentPath = join(workspacePath, SAMPLE_FILE);
  await copyFile(sampleBidSource, documentPath);
  expect(await partOrEmpty(documentPath, "word/comments.xml")).not.toContain(COMMENT_TEXT);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Document comments session");
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

    // --- Insert > Comment on the caret's own word, then write it ---
    await documentView.locator(".doc-page").getByText(REAL_HEADING).first().click();
    await pressDocumentMenuCommand(harness.electronApp, "insert-comment");

    const composer = documentView.locator(".comment-compose textarea");
    await expect(composer).toBeVisible({ timeout: 15_000 });
    await composer.fill(COMMENT_TEXT);
    await documentView.locator(".comment-compose-actions button.primary").click();
    await expect(documentView.locator(".comments-pane-list")).toContainText(COMMENT_TEXT);

    // --- save, then look at the file the way any other editor would ---
    await pressDocumentMenuCommand(harness.electronApp, "save");

    await expect
      .poll(async () => partOrEmpty(documentPath, "word/comments.xml"), { timeout: 30_000 })
      .toContain(COMMENT_TEXT);
    const comments = await partOrEmpty(documentPath, "word/comments.xml");
    // The comment is a real one: it carries an author, and the body anchors it.
    expect(comments).toContain('w:author="User"');
    expect(await partOrEmpty(documentPath, "word/document.xml")).toContain("commentRangeStart");
  } finally {
    await harness.close();
  }
});
