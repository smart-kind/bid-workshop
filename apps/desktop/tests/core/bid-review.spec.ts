import { copyFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
} from "../helpers/electron-app";
import { expectExtensionViewReady } from "../helpers/desktop-extension-fixture";

const repoRoot = resolve(__dirname, "../../../..");
/** The real extension entry, loaded from its checkout so its dependencies resolve. */
const bidReviewEntry = join(repoRoot, "extensions", "bid-review", "index.ts");
/** The committed sample bid. The panel loads it by file name from the workspace. */
const SAMPLE_FILE = "投标文件-某软件科技.docx";
const sampleBidSource = join(repoRoot, "workspaces", "bid-sample", SAMPLE_FILE);

/** In the no-files state the panel renders one button per SAMPLE_FILES entry. */
const SAMPLE_BUTTON_LABEL = "投标文件 — 某软件科技有限公司";

/**
 * Facts the real file produces through the extension's own parser (`parseDocx`):
 * 74 visible blocks, 3 tables and 17 headings. A fixture or mock fallback would
 * not reproduce them, so these assertions fail if parsing ever stops happening.
 */
const EXPECTED_BLOCK_COUNT = 74;
const EXPECTED_TABLE_COUNT = 3;
/** Titles that must appear for the outline to come from the document, not a fixture. */
const REAL_HEADINGS = [
  "第一章  投标人基本情况",
  "第二章  资质与业绩",
  "第三章  技术方案",
  "第四章  商务报价",
  "第五章  服务承诺",
];
/** A paragraph that exists only in the document body, shown by the document view. */
const REAL_PARAGRAPH = "投标人（盖章）：";

/** Open an extension view by its registered title, as a tab in the workbench. */
async function openExtensionView(window: Page, title: string): Promise<FrameLocator> {
  const workbench = window.getByTestId("workbench");
  if (!(await workbench.isVisible())) await window.getByTestId("toggle-side-panel").click();
  const tab = workbench.getByRole("tab", { name: title, exact: true });
  if (await tab.count()) await tab.click();
  else {
    const chooser = window.getByTestId("workbench-chooser");
    if (!(await chooser.isVisible())) await window.getByTestId("workbench-add-tab").click();
    await chooser.getByRole("button", { name: title, exact: true }).click();
  }
  await expectExtensionViewReady(window);
  return window.frameLocator('[data-testid="extension-view-frame"]');
}

test("the bid-review panel parses the real sample .docx and the document view shows it", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("bid-review-workspace");
  await copyFile(sampleBidSource, join(workspacePath, SAMPLE_FILE));

  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      packages: [],
      extensions: [bidReviewEntry],
      cacheWarming: "off",
    }),
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Bid review session");

    // --- the review panel loads and summarises the document ---
    const review = await openExtensionView(window, "Bid Review");
    const sampleButton = review.getByRole("button", { name: SAMPLE_BUTTON_LABEL, exact: true });
    await expect(sampleButton).toBeVisible();
    await sampleButton.click();

    // Loading is a round trip to the extension backend, so wait on the panel
    // reaching the loaded state rather than reading it straight after the click.
    // The counts and headings only exist in the real .docx, so mock data cannot
    // satisfy them.
    await expect(review.locator("body")).toContainText(`已加载 1 份文件：${SAMPLE_FILE}`, {
      timeout: 30_000,
    });
    await expect(review.locator("body")).toContainText(`${EXPECTED_BLOCK_COUNT} 个块`);
    await expect(review.locator("body")).toContainText(`${EXPECTED_TABLE_COUNT} 张表`);
    for (const heading of REAL_HEADINGS) {
      await expect(review.locator("body")).toContainText(heading);
    }

    // --- the document view renders the body itself ---
    const documentView = await openExtensionView(window, "Bid Document");
    const body = documentView.locator("body");
    await expect(body).toContainText(`${fileSummary()}`, { timeout: 30_000 });
    await expect(body.locator("[data-document]")).toBeVisible();
    // Paragraphs come from the parsed document, not from the summary state.
    await expect(body).toContainText(REAL_PARAGRAPH);
    await expect(body).toContainText("承诺工期");
    await expect(body.locator("[data-block]").first()).toBeVisible();
  } finally {
    await harness.close();
  }
});

function fileSummary(): string {
  return `${SAMPLE_FILE}：${EXPECTED_BLOCK_COUNT} 个块，${EXPECTED_TABLE_COUNT} 张表`;
}
