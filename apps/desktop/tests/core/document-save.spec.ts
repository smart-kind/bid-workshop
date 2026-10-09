import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  selectSidePanel,
  writeTextFile,
} from "../helpers/electron-app";

/** T-15: the editor's Save asks the shell, and the shell decides. */

const repoRoot = resolve(__dirname, "../../../..");
const SAMPLE_FILE = "投标文件-某软件科技.docx";
const sampleBidSource = join(repoRoot, "workspaces", "bid-sample", SAMPLE_FILE);

const digest = async (path: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

async function waitForDocumentView(app: ElectronApplication, timeoutMs = 30_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = app.windows().find((candidate) => candidate.url().startsWith("bid-docs://"));
    if (page) return page;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("No document view appeared");
}

/** Type into the document and save through the editor's own automation hook. */
async function editAndSave(documentView: Page): Promise<boolean> {
  return documentView.evaluate(async () => {
    const hook = (
      window as unknown as {
        __aidocs?: {
          editor?: {
            chain: () => {
              focus: (at: string) => { insertContent: (text: string) => { run: () => void } };
            };
          };
          save: () => Promise<boolean> | boolean;
        };
      }
    ).__aidocs;
    hook?.editor?.chain().focus("end").insertContent(" 追加一行").run();
    return Boolean(await Promise.resolve(hook?.save()));
  });
}

async function openSample(workspacePath: string, relativePath: string) {
  const harness = await launchDesktop(await makeUserDataDir(), {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  const window = await harness.firstWindow();
  await createNamedThread(window, "Document save session");
  await selectSidePanel(window, "Files");
  // A file inside a directory is not in the tree until its directory is open.
  const directory = relativePath.includes("/")
    ? relativePath.slice(0, relativePath.indexOf("/"))
    : "";
  if (directory) {
    await window.locator(".file-workbench__tree-row--dir", { hasText: directory }).click();
  }
  await window.locator(`.file-workbench__tree-row--file[data-file-path="${relativePath}"]`).click();
  const documentView = await waitForDocumentView(harness.electronApp);
  await expect(documentView.locator(".doc-page")).toBeVisible({ timeout: 30_000 });
  return { harness, window, documentView };
}

test("saving writes the document through the shell and keeps a backup", async () => {
  test.setTimeout(120_000);
  const workspacePath = await makeWorkspace("document-save-workspace");
  await copyFile(sampleBidSource, join(workspacePath, SAMPLE_FILE));
  const before = await digest(join(workspacePath, SAMPLE_FILE));
  const { harness, documentView } = await openSample(workspacePath, SAMPLE_FILE);

  try {
    expect(await editAndSave(documentView)).toBe(true);

    await expect
      .poll(async () => (await digest(join(workspacePath, SAMPLE_FILE))) !== before)
      .toBe(true);
    // What was there before the save is kept, under a name that says when.
    const backups = (await readdir(workspacePath)).filter((name) => name.includes(".bak-"));
    expect(backups).toHaveLength(1);
    expect(await digest(join(workspacePath, backups[0] ?? ""))).toBe(before);
  } finally {
    await harness.close();
  }
});

test("a document in a read-only zone is refused, and the file is untouched", async () => {
  test.setTimeout(120_000);
  const workspacePath = await makeWorkspace("document-save-readonly");
  await mkdir(join(workspacePath, "招标文件"), { recursive: true });
  await copyFile(sampleBidSource, join(workspacePath, "招标文件", SAMPLE_FILE));
  await mkdir(join(workspacePath, ".bid"), { recursive: true });
  await writeTextFile(
    join(workspacePath, ".bid", "workspace.json"),
    JSON.stringify({ schemaVersion: 1, business: "bid-tender", zones: { material: ["招标文件"] } }),
  );
  const target = join(workspacePath, "招标文件", SAMPLE_FILE);
  const before = await digest(target);
  const { harness, documentView } = await openSample(workspacePath, `招标文件/${SAMPLE_FILE}`);

  try {
    expect(await editAndSave(documentView)).toBe(false);

    // Nothing was written, and nothing was set aside either.
    expect(await digest(target)).toBe(before);
    expect(
      (await readdir(join(workspacePath, "招标文件"))).filter((n) => n.includes(".bak-")),
    ).toEqual([]);
  } finally {
    await harness.close();
  }
});

/** Ask the preload to save exactly this, the way the editor's own shell would. */
async function saveViaPreload(
  documentView: Page,
  path: string,
  auto: boolean,
): Promise<{ ok: boolean; reason?: string; error?: string }> {
  return documentView.evaluate(
    async ([target, isAuto]) => {
      const desktop = (
        window as unknown as {
          desktop: {
            saveDocx: (
              path: string,
              bytes: Uint8Array,
              auto: boolean,
            ) => Promise<{ ok: boolean; reason?: string; error?: string }>;
          };
        }
      ).desktop;
      return desktop.saveDocx(target as string, new Uint8Array([1, 2, 3]), isAuto as boolean);
    },
    [path, auto] as const,
  );
}

test("only a path this editor opened may be overwritten", async () => {
  test.setTimeout(120_000);
  const workspacePath = await makeWorkspace("document-save-grant");
  await copyFile(sampleBidSource, join(workspacePath, SAMPLE_FILE));
  await mkdir(join(workspacePath, "产出"), { recursive: true });
  await writeTextFile(join(workspacePath, "产出", "别人的.docx"), "not ours");
  const { harness, documentView } = await openSample(workspacePath, SAMPLE_FILE);

  try {
    // A writable path the editor never opened is still refused.
    const foreign = join(workspacePath, "产出", "别人的.docx");
    const refused = await saveViaPreload(documentView, foreign, true);
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain("不是本编辑器打开或另存的文档");
    expect(await readFile(foreign, "utf8")).toBe("not ours");
  } finally {
    await harness.close();
  }
});

test("an autosave over a file another program changed is reported, not written", async () => {
  test.setTimeout(120_000);
  const workspacePath = await makeWorkspace("document-save-external");
  await copyFile(sampleBidSource, join(workspacePath, SAMPLE_FILE));
  const target = join(workspacePath, SAMPLE_FILE);
  const { harness, documentView } = await openSample(workspacePath, SAMPLE_FILE);

  try {
    // Another program lands a change while the editor is still holding its copy.
    await writeTextFile(target, "changed elsewhere");

    const result = await saveViaPreload(documentView, target, true);

    expect(result).toEqual({ ok: false, reason: "external-modified" });
    // Autosave never clobbers it.
    expect(await readFile(target, "utf8")).toBe("changed elsewhere");
  } finally {
    await harness.close();
  }
});
