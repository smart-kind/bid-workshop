import { copyFile, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { readDocumentText } from "@bid-workshop/document-service";
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
const PROBE = "ShellNewDocumentProbe2026";

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

async function docxIn(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory)).filter((name) => name.toLowerCase().endsWith(".docx"));
  } catch {
    return [];
  }
}

test("New Document blanks the open document, and saving writes a new file", async () => {
  test.setTimeout(180_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("document-new-workspace");
  await copyFile(sampleBidSource, join(workspacePath, SAMPLE_FILE));
  // Where a document without a path is written; the app would otherwise use the
  // real documents folder, and a test has no business writing there.
  const documentsDir = await mkdtemp(join(tmpdir(), "document-new-documents-"));

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: { PI_APP_DOCUMENTS_DIR: documentsDir },
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Document new session");
    await selectSidePanel(window, "Files");

    const tree = window.getByTestId("file-workbench-tree");
    const sampleRow = tree.locator(
      `.file-workbench__tree-row--file[data-file-path="${SAMPLE_FILE}"]`,
    );
    await expect(sampleRow).toBeVisible({ timeout: 15_000 });
    await sampleRow.click();

    const documentView = await waitForDocumentView(harness.electronApp);
    await expect(documentView.locator(".doc-page")).toBeVisible({ timeout: 30_000 });
    const body = documentView.locator("body");
    await expect(body).toContainText(REAL_HEADING, { timeout: 30_000 });

    // --- New Document blanks this view in place ---
    await pressDocumentMenuCommand(harness.electronApp, "new");
    await expect(body).not.toContainText(REAL_HEADING, { timeout: 30_000 });

    // --- an edit in the blank document, then save ---
    await documentView.locator(".doc-page").click();
    await documentView.keyboard.type(PROBE);
    await expect(body).toContainText(PROBE);

    expect(await docxIn(documentsDir)).toEqual([]);
    await pressDocumentMenuCommand(harness.electronApp, "save");

    // --- a document with no path saves as a new file, and reads back ---
    let written: string[] = [];
    await expect
      .poll(
        async () => {
          written = await docxIn(documentsDir);
          return written.length;
        },
        { timeout: 60_000 },
      )
      .toBeGreaterThan(0);

    const first = written[0];
    if (!first) throw new Error("No document was written");
    const text = await readDocumentText(new Uint8Array(await readFile(join(documentsDir, first))));
    expect(text).toContain(PROBE);

    // And the file the pane still names is untouched: a new document never saves
    // over the one that was open.
    const source = await readDocumentText(
      new Uint8Array(await readFile(join(workspacePath, SAMPLE_FILE))),
    );
    expect(source).toContain(REAL_HEADING);
    expect(source).not.toContain(PROBE);
  } finally {
    await harness.close();
  }
});
