import { readFile } from "node:fs/promises";
import { copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { readDocumentBlocks, readDocumentText } from "@bid-workshop/document-service";
import {
  createNamedThread,
  getRealAuthConfig,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

const repoRoot = resolve(__dirname, "../../../..");
const sampleBidSource = join(repoRoot, "workspaces", "bid-sample", "投标文件-某软件科技.docx");

const SOURCE_DOCUMENT = "标书.docx";
const GENERATED_DOCUMENT = "生成.docx";

/** Real text out of the document: the model can only produce it by reading the file. */
const REAL_HEADING = "投标人基本情况";
const CREATE_PROBE = "ShellModelCreateProbe2026";
const EDIT_PROBE = "ShellModelEditProbe2026";

/** A reasoning model on a long turn is slow; every wait here is generous on purpose. */
const TURN_TIMEOUT = 240_000;

async function prompt(window: Page, text: string): Promise<void> {
  const composer = window.getByTestId("composer");
  await composer.fill(text);
  await composer.press("Enter");
}

/** The newest assistant answer, or "" while the turn has not produced one yet. */
async function lastAnswer(window: Page): Promise<string> {
  const message = window.locator(".timeline-item--assistant .message__content").last();
  if ((await message.count()) === 0) return "";
  return message.innerText();
}

/** The document's text, or "" while it is not there yet (so a poll can keep waiting). */
async function documentText(path: string): Promise<string> {
  try {
    return await readDocumentText(new Uint8Array(await readFile(path)));
  } catch {
    return "";
  }
}

test("a real model reads, generates and changes documents in the thread's folder", async () => {
  test.setTimeout(900_000);
  const realAuth = getRealAuthConfig();
  test.skip(!realAuth.enabled, realAuth.skipReason);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("document-chain-workspace");
  await copyFile(sampleBidSource, join(workspacePath, SOURCE_DOCUMENT));
  const generatedPath = join(workspacePath, GENERATED_DOCUMENT);
  const sourcePath = join(workspacePath, SOURCE_DOCUMENT);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    realAuthSourceDir: realAuth.sourceDir,
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Document chain");

    // --- read: the answer has to come from the file, not from the prompt ---
    await prompt(
      window,
      `用 read_docx 读取 ${SOURCE_DOCUMENT}，然后原样列出里面的一级标题，不要解释，不要补充。`,
    );
    await expect.poll(() => lastAnswer(window), { timeout: TURN_TIMEOUT }).toContain(REAL_HEADING);

    // --- generate a new file ---
    await prompt(
      window,
      `用 create_docx 新建 ${GENERATED_DOCUMENT}，内容是一个标题「Shell 链路验证」和一段正文「${CREATE_PROBE}」。` +
        `完成后只回复 DONE。`,
    );
    await expect
      .poll(() => documentText(generatedPath), { timeout: TURN_TIMEOUT })
      .toContain(CREATE_PROBE);
    const generated = await readDocumentBlocks(new Uint8Array(await readFile(generatedPath)));
    expect(generated.map((block) => block.text)).toEqual(["Shell 链路验证", CREATE_PROBE]);

    // --- change an existing file ---
    await prompt(
      window,
      `用 read_docx 读 ${SOURCE_DOCUMENT}，再用 update_docx 在第 1 个块之后插入一段「${EDIT_PROBE}」。` +
        `完成后只回复 DONE。`,
    );
    await expect
      .poll(() => documentText(sourcePath), { timeout: TURN_TIMEOUT })
      .toContain(EDIT_PROBE);
  } finally {
    await harness.close();
  }
});
