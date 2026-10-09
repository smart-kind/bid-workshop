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
const MARKER = "ShellRevisionProbe2026";

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

async function documentXml(filePath: string): Promise<string> {
  const archive = await JSZip.loadAsync(await readFile(filePath));
  const entry = archive.file("word/document.xml");
  if (!entry) throw new Error(`word/document.xml is missing from ${filePath}`);
  return entry.async("string");
}

function trackedInsertions(xml: string): number {
  return (xml.match(/<w:ins\b/g) ?? []).length;
}

test("a tracked change is recorded in the file as a revision", async () => {
  test.setTimeout(180_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("document-revisions-workspace");
  const documentPath = join(workspacePath, SAMPLE_FILE);
  await copyFile(sampleBidSource, documentPath);
  // The sample carries no revision marks at all, so any that appear are ours.
  expect(trackedInsertions(await documentXml(documentPath))).toBe(0);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Document revisions session");
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

    // --- turn Track Changes on (⇧⌘E, the editor's own binding) and type ---
    await documentView.locator(".doc-page").getByText(REAL_HEADING).first().click();
    await documentView.keyboard.press("Meta+Shift+E");
    await documentView.keyboard.press("End");
    await documentView.keyboard.type(` ${MARKER}`);
    await expect(documentView.locator("body")).toContainText(MARKER);

    await pressDocumentMenuCommand(harness.electronApp, "save");

    // --- the edit lands in the file as a revision, not as applied text ---
    await expect
      .poll(async () => trackedInsertions(await documentXml(documentPath)), { timeout: 30_000 })
      .toBeGreaterThan(0);
    // Only this change, and only of this kind. The editor's own bookkeeping
    // reports hundreds of revisions for this document (see docs/shell-plan.md
    // §8.6), and none of them may reach the file: a leak would show up here as
    // rPr/pPr changes or as insertions scattered across the whole body.
    const saved = await documentXml(documentPath);
    expect(trackedInsertions(saved)).toBeGreaterThan(0);
    expect(trackedInsertions(saved)).toBeLessThan(10);
    expect(saved.match(/<w:rPrChange\b/g) ?? []).toHaveLength(0);
    expect(saved.match(/<w:pPrChange\b/g) ?? []).toHaveLength(0);
    expect(saved.match(/<w:del\b/g) ?? []).toHaveLength(0);
    expect(saved).toContain(MARKER);

    // --- accepting the revision rewrites the file: D9's other half ---
    await documentView.locator(".ribbon-tab", { hasText: "审阅" }).first().click();
    const acceptSplit = documentView.locator(".rb-split-wrap", { hasText: "接受" }).first();
    const tip = (await acceptSplit.locator("button.rb-big").first().getAttribute("data-tip")) ?? "";
    // One typed word is one revision. Hundreds would mean the save's own reload of
    // the file was recorded as an edit to the whole document (§8.6).
    expect(Number(tip.replace(/[^\d]/g, ""))).toBeLessThan(10);

    await acceptSplit.locator("button.rb-big").first().click();
    await acceptSplit.locator(".layout-menu button", { hasText: "接受所有修订" }).click();
    await pressDocumentMenuCommand(harness.electronApp, "save");

    await expect
      .poll(async () => trackedInsertions(await documentXml(documentPath)), { timeout: 30_000 })
      .toBe(0);
    // Accepted, not dropped: the text the insertion carried is still there.
    expect(await documentXml(documentPath)).toContain(MARKER);
  } finally {
    await harness.close();
  }
});
