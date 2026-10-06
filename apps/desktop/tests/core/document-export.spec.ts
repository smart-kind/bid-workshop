import { readFile, stat, copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
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

/** Stands in for the user choosing a destination in the native save dialog. */
async function chooseSavePath(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, wanted) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: wanted });
  }, filePath);
}

async function sizeOf(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

test("Export writes real HTML and PDF files for the open document", async () => {
  test.setTimeout(180_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("document-export-workspace");
  await copyFile(sampleBidSource, join(workspacePath, SAMPLE_FILE));
  const exportDir = await mkdtemp(join(tmpdir(), "document-export-"));
  const htmlPath = join(exportDir, "export.html");
  const pdfPath = join(exportDir, "export.pdf");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Document export session");
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

    // --- HTML: the renderer hands over the markup, main writes it ---
    await chooseSavePath(harness.electronApp, htmlPath);
    await pressDocumentMenuCommand(harness.electronApp, "export-html");
    await expect.poll(() => sizeOf(htmlPath), { timeout: 60_000 }).toBeGreaterThan(500);
    expect(await readFile(htmlPath, "utf8")).toContain(REAL_HEADING);

    // --- PDF: the document view prints itself through Chromium ---
    await chooseSavePath(harness.electronApp, pdfPath);
    await pressDocumentMenuCommand(harness.electronApp, "export-pdf");
    await expect.poll(() => sizeOf(pdfPath), { timeout: 120_000 }).toBeGreaterThan(1_000);
    const pdf = await readFile(pdfPath);
    expect(pdf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    // A real render, not an empty page: Chromium's own PDF of this document.
    expect(pdf.byteLength).toBeGreaterThan(5_000);
  } finally {
    await harness.close();
  }
});
