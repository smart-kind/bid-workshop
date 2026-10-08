import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { commentsByBlock, setBidCommentWriter } from "../document";
import { docxCommentWriter, docxParser } from "../parser-docx.mjs";
import { writeBidWorkingCopy } from "../working-copy";

/** T-14: a finding about a table cell degrades to the table's paragraph, out loud. */

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const SAMPLE_FILE = "投标文件-某软件科技.docx";

setBidCommentWriter(docxCommentWriter);

test("anchors a table finding above the table and says it is not the cell", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bid-table-anchor-"));
  const source = join(directory, SAMPLE_FILE);
  await copyFile(join(repoRoot, "workspaces", "bid-sample", SAMPLE_FILE), source);

  const original = await docxParser.parse(source);
  const visible = original.parsed.blocks.filter((block) => !block.hidden);
  const tableIndex = visible.findIndex((block) => Boolean(block.table));
  expect(tableIndex).toBeGreaterThan(0);

  const result = await writeBidWorkingCopy({
    sourcePath: source,
    comments: [
      {
        id: "F-table",
        author: "审查",
        text: "报价合计与明细不符",
        blockIndex: tableIndex,
        cell: { row: 3, column: 2, label: "合计" },
      },
    ],
  });

  expect(result.status).toBe("written");
  if (result.status !== "written") return;
  expect(result.written).toBe(1);
  expect(result.skipped).toEqual([]);
  expect(result.degraded).toHaveLength(1);
  const [degraded] = result.degraded;
  expect(degraded?.reason).toBe("table-cell");
  expect(degraded?.cell).toEqual({ row: 3, column: 2, label: "合计" });
  // It landed on the paragraph just above the table, not on the table.
  expect(degraded?.anchorBlockIndex).toBe(tableIndex - 1);

  const copy = await docxParser.parse(result.outputPath);
  expect(copy.parsed.blocks.filter((block) => !block.hidden).length).toBe(visible.length);

  const written = copy.parsed.comments.find((comment) =>
    comment.text.includes("报价合计与明细不符"),
  );
  expect(written).toBeDefined();
  expect(written?.text).toContain("第3行");
  expect(written?.text).toContain("合计");
  expect(written?.text).toContain("未锚定到单元格");
  expect(written?.text).not.toContain("已精确");

  const grouped = commentsByBlock(copy.parsed);
  expect(grouped.unanchored).toEqual([]);
  expect(grouped.byBlock.get(tableIndex - 1)?.map((comment) => comment.id)).toEqual(
    written ? [written.id] : [],
  );
});

test("still writes an ordinary paragraph finding untouched", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bid-table-anchor-plain-"));
  const source = join(directory, SAMPLE_FILE);
  await copyFile(join(repoRoot, "workspaces", "bid-sample", SAMPLE_FILE), source);

  const result = await writeBidWorkingCopy({
    sourcePath: source,
    comments: [{ id: "F-1", author: "审查", text: "正文问题", blockIndex: 0 }],
  });

  expect(result.status).toBe("written");
  if (result.status !== "written") return;
  expect(result.degraded).toEqual([]);
  expect(result.skipped).toEqual([]);

  const copy = await docxParser.parse(result.outputPath);
  const written = copy.parsed.comments.find((comment) => comment.text === "正文问题");
  expect(written).toBeDefined();
  expect(await readFile(source)).not.toEqual(await readFile(result.outputPath));
});
