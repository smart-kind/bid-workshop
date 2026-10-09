import { copyFile } from "node:fs/promises";
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
/** The committed sample bid, opened from the workspace file tree. */
const SAMPLE_FILE = "投标文件-某软件科技.docx";
const sampleBidSource = join(repoRoot, "workspaces", "bid-sample", SAMPLE_FILE);

/** Real document text: a fixture or a failed parse cannot produce it. */
const REAL_HEADING_FRAGMENT = "投标人基本情况";
const REAL_PARAGRAPH = "投标人（盖章）";

interface ViewBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The hosted document view is a WebContentsView; Playwright exposes it as its own page. */
async function waitForDocumentView(app: ElectronApplication, timeoutMs = 30_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = app.windows().find((candidate) => candidate.url().startsWith("bid-docs://"));
    if (page) return page;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  const urls = app.windows().map((candidate) => candidate.url() || "<empty>");
  throw new Error(`No document view appeared (windows: ${urls.join(", ") || "<none>"})`);
}

/** Bounds of the attached document view, straight from the main process. */
function documentViewBounds(app: ElectronApplication): Promise<ViewBounds | null> {
  return app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return null;
    for (const child of window.contentView.children) {
      const view = child as unknown as {
        readonly webContents?: { getURL(): string };
        getBounds(): ViewBounds;
      };
      if (view.webContents?.getURL().startsWith("bid-docs://")) {
        return view.getBounds();
      }
    }
    return null;
  });
}

test("a .docx opened from the Files tree renders in the hosted document view", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("document-view-workspace");
  await copyFile(sampleBidSource, join(workspacePath, SAMPLE_FILE));

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Document view session");
    await selectSidePanel(window, "Files");

    const tree = window.getByTestId("file-workbench-tree");
    const sampleRow = tree.locator(
      `.file-workbench__tree-row--file[data-file-path="${SAMPLE_FILE}"]`,
    );
    await expect(sampleRow).toBeVisible({ timeout: 15_000 });

    // Nothing is hosted until a document is selected.
    expect(
      harness.electronApp.windows().filter((page) => page.url().startsWith("bid-docs://")),
    ).toHaveLength(0);

    await sampleRow.click();

    // --- the document view mounts and renders the real .docx ---
    const documentView = await waitForDocumentView(harness.electronApp);
    await expect(documentView.locator(".doc-page")).toBeVisible({ timeout: 30_000 });
    const body = documentView.locator("body");
    await expect(body).toContainText(REAL_HEADING_FRAGMENT, { timeout: 30_000 });
    await expect(body).toContainText(REAL_PARAGRAPH);

    // --- positioned over the Files pane body, not floating elsewhere ---
    const paneRect = await window.locator(".file-editor__body").boundingBox();
    const bounds = await documentViewBounds(harness.electronApp);
    expect(paneRect).not.toBeNull();
    expect(bounds).not.toBeNull();
    if (paneRect && bounds) {
      expect(Math.abs(bounds.x - paneRect.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(bounds.y - paneRect.y)).toBeLessThanOrEqual(2);
      expect(Math.abs(bounds.width - paneRect.width)).toBeLessThanOrEqual(2);
      expect(Math.abs(bounds.height - paneRect.height)).toBeLessThanOrEqual(2);
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.height).toBeGreaterThan(0);
    }

    // --- selecting another file detaches the host from the pane ---
    await tree.locator('.file-workbench__tree-row--file[data-file-path="README.md"]').click();
    await expect
      .poll(async () => (await documentViewBounds(harness.electronApp))?.width ?? -1)
      .toBe(0);
  } finally {
    await harness.close();
  }
});
