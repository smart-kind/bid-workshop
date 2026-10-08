import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { setBidCommentWriter } from "../document";
import { FINALIZE_NOTE, finalFileName, finalizeBidDocument } from "../finalize";
import { docxCommentWriter, docxParser } from "../parser-docx.mjs";
import { writeBidWorkingCopy } from "../working-copy";

/** T-26: finalising adds a file and changes neither of the two that existed. */

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const SAMPLE_FILE = "投标文件-某软件科技.docx";

setBidCommentWriter(docxCommentWriter);

const digest = async (path: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

async function staged() {
  const directory = await mkdtemp(join(tmpdir(), "bid-finalize-"));
  const source = join(directory, SAMPLE_FILE);
  await copyFile(join(repoRoot, "workspaces", "bid-sample", SAMPLE_FILE), source);
  const written = await writeBidWorkingCopy({
    sourcePath: source,
    comments: [{ id: "F-1", author: "审查", text: "报价与明细不符", blockIndex: 0 }],
  });
  expect(written.status).toBe("written");
  if (written.status !== "written") throw new Error("working copy was not written");
  return { directory, source, workingCopy: written.outputPath };
}

test("names the final copy after the working copy and the date", () => {
  expect(finalFileName("/w/书-批注.docx", "2026-10-08")).toBe("书-批注-定稿2026-10-08.docx");
  expect(finalFileName("书-批注.docx")).toBe("书-批注-定稿.docx");
  expect(finalFileName("说明", "2026-10-08")).toBe("说明-定稿2026-10-08.docx");
});

test("finalising keeps the original and the working copy, and carries the comments", async () => {
  const { source, workingCopy } = await staged();
  const originalBefore = await digest(source);
  const copyBefore = await digest(workingCopy);

  const result = await finalizeBidDocument({
    copyPath: workingCopy,
    date: "2026-10-08",
  });

  expect(result.outputPath).toBe(
    join(workingCopy, "..", "投标文件-某软件科技-批注-定稿2026-10-08.docx"),
  );
  // Both files that existed are exactly as they were.
  expect(await digest(source)).toBe(originalBefore);
  expect(await digest(workingCopy)).toBe(copyBefore);
  expect((await stat(workingCopy)).isFile()).toBe(true);

  // The final copy carries the comments, and the original still has none.
  const final = await docxParser.parse(result.outputPath);
  expect(final.parsed.comments.map((comment) => comment.text)).toEqual(["报价与明细不符"]);
  expect((await docxParser.parse(source)).parsed.comments).toEqual([]);
});

test("the wording says the body was not rewritten", () => {
  expect(FINALIZE_NOTE).toContain("正文未被改写");
  expect(FINALIZE_NOTE).toContain("原稿与工作副本都保留");
  expect(FINALIZE_NOTE).not.toMatch(/已改写|自动替换|正文已更新/);
});

test("refuses when the working copy is not there instead of inventing one", async () => {
  await expect(
    finalizeBidDocument({ copyPath: join(tmpdir(), "missing-批注.docx"), date: "2026-10-08" }),
  ).rejects.toThrow(/工作副本不存在/);
});
