import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type TestInfo } from "@playwright/test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  createDocumentRuntimeTools,
  createDocumentToolName,
  readDocumentToolName,
  updateDocumentToolName,
} from "../../electron/documents/document-runtime";

/**
 * The shell's document tools, driven the way the agent drives them.
 *
 * The tools are plain objects and take their working folder from the extension
 * context, so they run here without Electron — which is the point: `ctx.cwd` is
 * the thread's folder, and nothing may leave it.
 */
function contextIn(cwd: string): ExtensionContext {
  return { cwd } as ExtensionContext;
}

interface ToolResult {
  readonly content: readonly { readonly type: string; readonly text?: string }[];
  readonly details?: Record<string, unknown>;
  readonly isError?: boolean;
}

async function runTool(name: string, cwd: string, params: unknown): Promise<ToolResult> {
  const tool = createDocumentRuntimeTools().find((entry) => entry.name === name);
  if (!tool) throw new Error(`Unknown document tool: ${name}`);
  return (await tool.execute(
    `test-${name}`,
    params,
    undefined,
    undefined,
    contextIn(cwd),
  )) as ToolResult;
}

function textOf(result: ToolResult): string {
  return result.content.map((part) => part.text ?? "").join("\n");
}

async function workingFolder(testInfo: TestInfo): Promise<string> {
  return mkdtemp(join(tmpdir(), `document-tools-${testInfo.workerIndex}-`));
}

test("the agent can write a document and read it back", async ({}, testInfo) => {
  const cwd = await workingFolder(testInfo);

  const created = await runTool(createDocumentToolName, cwd, {
    path: "generated.docx",
    paragraphs: [{ text: "生成的标题", level: 1 }, { text: "第一段 ShellToolProbe2026" }],
  });
  expect(created.isError).toBeFalsy();
  expect(created.details?.path).toBe(join(cwd, "generated.docx"));

  const read = await runTool(readDocumentToolName, cwd, { path: "generated.docx" });
  expect(read.isError).toBeFalsy();
  expect(textOf(read)).toContain("第一段 ShellToolProbe2026");
  expect(read.details?.blockCount).toBe(2);
  // The listing carries the indexes an edit has to use.
  expect(textOf(read)).toContain("[1] paragraph");
});

test("an edit changes the file on disk and reports the new indexes", async ({}, testInfo) => {
  const cwd = await workingFolder(testInfo);
  await runTool(createDocumentToolName, cwd, {
    path: "edit.docx",
    paragraphs: [{ text: "原名" }, { text: "第二段" }],
  });

  const updated = await runTool(updateDocumentToolName, cwd, {
    path: "edit.docx",
    operations: [
      { kind: "replace", blockIndex: 0, text: "改过的名字" },
      { kind: "insert", text: "插在中间", afterBlockIndex: 0 },
    ],
  });
  expect(updated.isError).toBeFalsy();

  const read = await runTool(readDocumentToolName, cwd, { path: "edit.docx" });
  const lines = textOf(read).split("\n");
  expect(lines[0]).toContain("改过的名字");
  expect(lines[1]).toContain("插在中间");
  expect(lines[2]).toContain("第二段");

  // And it really is the file, not just the answer.
  const onDisk = await readFile(join(cwd, "edit.docx"));
  expect(onDisk.byteLength).toBeGreaterThan(0);
});

test("the tools refuse to reach outside the thread's folder", async ({}, testInfo) => {
  const cwd = await workingFolder(testInfo);
  const outside = join(cwd, "..", "outside.docx");
  await writeFile(outside, "not a document");

  const escaped = await runTool(createDocumentToolName, cwd, {
    path: "../outside.docx",
    paragraphs: [{ text: "nope" }],
  });
  expect(escaped.isError).toBe(true);
  expect(textOf(escaped)).toMatch(/escapes/i);

  // Reading through the same escape is refused too.
  const readOutside = await runTool(readDocumentToolName, cwd, { path: "../outside.docx" });
  expect(readOutside.isError).toBe(true);
});

test("creating never overwrites, and bad operations come back as errors", async ({}, testInfo) => {
  const cwd = await workingFolder(testInfo);
  await runTool(createDocumentToolName, cwd, {
    path: "taken.docx",
    paragraphs: [{ text: "第一次" }],
  });

  const again = await runTool(createDocumentToolName, cwd, {
    path: "taken.docx",
    paragraphs: [{ text: "第二次" }],
  });
  expect(again.isError).toBe(true);
  expect(textOf(again)).toContain("already exists");

  const bad = await runTool(updateDocumentToolName, cwd, {
    path: "taken.docx",
    operations: [{ kind: "deleteEverything", text: "x" }],
  });
  expect(bad.isError).toBe(true);

  const outOfRange = await runTool(updateDocumentToolName, cwd, {
    path: "taken.docx",
    operations: [{ kind: "replace", blockIndex: 99, text: "x" }],
  });
  expect(outOfRange.isError).toBe(true);
  expect(textOf(outOfRange)).toMatch(/out of range/);
});
