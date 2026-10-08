import { copyFile, mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { commentsByBlock, setBidCommentWriter } from "../document";
import { docxCommentWriter, docxParser } from "../parser-docx.mjs";
import {
  fingerprintBytes,
  workingCopyFileName,
  workingCopyPath,
  writeBidWorkingCopy,
} from "../working-copy";

/** T-12: the headless write path, exercised on the real sample bid. */

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const SAMPLE_FILE = "投标文件-某软件科技.docx";
const sampleSource = join(repoRoot, "workspaces", "bid-sample", SAMPLE_FILE);

setBidCommentWriter(docxCommentWriter);

async function stageSample(): Promise<{ source: string; outputDirectory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "bid-working-copy-"));
  const source = join(directory, SAMPLE_FILE);
  await copyFile(sampleSource, source);
  const outputDirectory = join(directory, "产出");
  await mkdir(outputDirectory, { recursive: true });
  return { source, outputDirectory };
}

test("names the copy after the source and keeps its extension", () => {
  expect(workingCopyFileName("投标文件-某软件科技.docx")).toBe("投标文件-某软件科技-批注.docx");
  expect(workingCopyFileName("a/b/报告.docx", "-定稿")).toBe("报告-定稿.docx");
  expect(workingCopyFileName("说明")).toBe("说明-批注");
  expect(workingCopyPath("/w/招标文件/书.docx", "/w/产出")).toBe("/w/产出/书-批注.docx");
});

test("writes a marked-up copy into the output directory and reads the comments back", async () => {
  const { source, outputDirectory } = await stageSample();
  const original = await docxParser.parse(source);
  const originalBytes = await readFile(source);

  const result = await writeBidWorkingCopy({
    sourcePath: source,
    outputDirectory,
    comments: [
      { id: "F-1", author: "审查", text: "资质文件缺失", blockIndex: 0 },
      { id: "F-2", author: "审查", text: "报价与明细不一致", blockIndex: 1 },
    ],
  });

  expect(result.status).toBe("written");
  if (result.status !== "written") return;
  expect(result.outputPath).toBe(join(outputDirectory, "投标文件-某软件科技-批注.docx"));
  expect(result.written).toBe(2);
  expect(result.skipped).toEqual([]);
  expect(result.sourceFingerprint).toBe(fingerprintBytes(originalBytes));

  const copy = await docxParser.parse(result.outputPath);
  expect(copy.parsed.comments.map((comment) => comment.text)).toEqual(
    expect.arrayContaining(["资质文件缺失", "报价与明细不一致"]),
  );
  expect(copy.parsed.blocks.length).toBe(original.parsed.blocks.length);

  expect(await readFile(source)).toEqual(originalBytes);
  expect(original.parsed.comments).toEqual([]);

  // Each comment reads back attached to the block it was anchored to.
  const grouped = commentsByBlock(copy.parsed);
  expect(grouped.unanchored).toEqual([]);
  expect(grouped.byBlock.get(0)?.map((comment) => comment.text)).toEqual(["资质文件缺失"]);
  expect(grouped.byBlock.get(1)?.map((comment) => comment.text)).toEqual(["报价与明细不一致"]);
  expect(grouped.byBlock.get(0)?.map((comment) => comment.done)).toEqual([undefined]);
});

test("refuses before writing when the destination is read-only", async () => {
  const { source, outputDirectory } = await stageSample();

  const result = await writeBidWorkingCopy({
    sourcePath: source,
    outputDirectory,
    comments: [{ id: "F-1", author: "审查", text: "x", blockIndex: 0 }],
    readOnlyReason: "产出 是只读分区",
  });

  expect(result.status).toBe("refused");
  await expect(stat(workingCopyPath(source, outputDirectory))).rejects.toThrow();
});

test("classifies an unreadable source instead of throwing", async () => {
  const { source, outputDirectory } = await stageSample();

  const result = await writeBidWorkingCopy({
    sourcePath: join(source, "..", "does-not-exist.docx"),
    outputDirectory,
    comments: [{ id: "F-1", author: "审查", text: "x", blockIndex: 0 }],
  });

  expect(result.status).toBe("failed");
  if (result.status !== "failed") return;
  expect(result.reason).toBe("unreadable");
});
