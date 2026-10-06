import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { launchDesktop, makeUserDataDir } from "../helpers/electron-app";

const repoRoot = resolve(__dirname, "../../../..");
const sampleBidSource = resolve(repoRoot, "workspaces", "bid-sample", "投标文件-某软件科技.docx");

interface DocumentHooks {
  readonly readDocumentTextForTest?: (filePath: string) => Promise<string>;
}

/**
 * The shell's own document capability, exercised inside the main process.
 *
 * That is the part worth testing here: the vendored engine is TypeScript sources,
 * so main only works if the service's package is bundled into it rather than
 * required at run time.
 */
test("the shell reads a .docx from disk without opening it in the editor", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const harness = await launchDesktop(userDataDir, { testMode: "background" });

  try {
    await harness.firstWindow();
    const text = await harness.electronApp.evaluate(async (_, filePath) => {
      const hooks = (globalThis as { __PI_APP_TEST_HOOKS?: DocumentHooks }).__PI_APP_TEST_HOOKS;
      if (!hooks?.readDocumentTextForTest) {
        throw new Error("The document-service test hook is unavailable");
      }
      return hooks.readDocumentTextForTest(filePath);
    }, sampleBidSource);

    // Real text out of a real file: a fixture or a failed bundle cannot produce it.
    expect(text).toContain("投标人基本情况");
    expect(text).toContain("投标人（盖章）");
  } finally {
    await harness.close();
  }
});
