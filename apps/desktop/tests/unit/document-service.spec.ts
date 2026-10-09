import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createDocument,
  insertParagraph,
  readDocumentBlocks,
  readDocumentText,
  replaceParagraphText,
} from "@bid-workshop/document-service";
import type { DocumentBlockRef } from "@bid-workshop/document-service";

const repoRoot = resolve(__dirname, "../../../..");
const samplePath = resolve(repoRoot, "workspaces", "bid-sample", "投标文件-某软件科技.docx");

const CREATE_PROBE = "ShellCreateProbe2026";
const REPLACE_PROBE = "ShellReplaceProbe2026";
const INSERT_PROBE = "ShellInsertProbe2026";

function indexOfProbe(blocks: readonly DocumentBlockRef[], needle: string): number {
  const found = blocks.find((block) => block.text.includes(needle));
  if (!found) throw new Error(`No block contains ${needle}`);
  return found.index;
}

test("a document the shell creates reads back with its paragraphs in order", async () => {
  const bytes = await createDocument([
    { text: "Shell 生成的标题", level: 1 },
    { text: `第一段 ${CREATE_PROBE}` },
    { text: "第二段" },
  ]);

  const blocks = await readDocumentBlocks(bytes);
  expect(blocks.map((block) => block.text)).toEqual([
    "Shell 生成的标题",
    `第一段 ${CREATE_PROBE}`,
    "第二段",
  ]);
  // The heading is a heading, not a paragraph that happens to look like one.
  expect(blocks[0]?.text).toBe("Shell 生成的标题");
  expect(blocks[0]?.level).toBe(1);
  expect(await readDocumentText(bytes)).toContain(CREATE_PROBE);
});

test("editing a real document changes one block and leaves the others alone", async () => {
  const original = new Uint8Array(await readFile(samplePath));
  const before = await readDocumentBlocks(original);
  const target = indexOfProbe(before, "投标人基本情况");

  const replaced = await replaceParagraphText(original, {
    blockIndex: target,
    text: REPLACE_PROBE,
  });
  const afterReplace = await readDocumentBlocks(replaced);
  expect(afterReplace.length).toBe(before.length);
  expect(afterReplace[target]?.text).toBe(REPLACE_PROBE);
  // Everything else survives untouched — that is the whole risk with a rebuilt block.
  expect(afterReplace.filter((_, index) => index !== target).map((block) => block.text)).toEqual(
    before.filter((_, index) => index !== target).map((block) => block.text),
  );

  const inserted = await insertParagraph(replaced, {
    paragraph: { text: INSERT_PROBE },
    afterBlockIndex: target,
  });
  const afterInsert = await readDocumentBlocks(inserted);
  expect(afterInsert.length).toBe(before.length + 1);
  expect(afterInsert[target + 1]?.text).toBe(INSERT_PROBE);
  expect(afterInsert[target]?.text).toBe(REPLACE_PROBE);
  expect(afterInsert[target + 2]?.text).toBe(afterReplace[target + 1]?.text);
});

test("an edit refuses what it cannot do instead of corrupting the file", async () => {
  const original = new Uint8Array(await readFile(samplePath));
  const blocks = await readDocumentBlocks(original);
  const table = blocks.find((block) => block.type === "table");
  expect(table).toBeDefined();

  await expect(replaceParagraphText(original, { blockIndex: 9999, text: "nope" })).rejects.toThrow(
    /out of range/,
  );
  await expect(
    insertParagraph(original, { paragraph: { text: "nope" }, afterBlockIndex: 9999 }),
  ).rejects.toThrow(/out of range/);
  if (table) {
    await expect(
      replaceParagraphText(original, { blockIndex: table.index, text: "nope" }),
    ).rejects.toThrow(/only paragraphs/);
  }
});
