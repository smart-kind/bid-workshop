import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import {
  addComments,
  readDocumentComments,
  readDocumentBlocks,
  replaceParagraphText,
} from "@bid-workshop/document-service";

const repoRoot = resolve(__dirname, "../../../..");
const samplePath = resolve(repoRoot, "workspaces", "bid-sample", "投标文件-某软件科技.docx");

const COMMENT_PROBE = "ShellServiceCommentProbe2026";
const SECOND_PROBE = "ShellServiceCommentProbe2026b";

async function commentsXml(bytes: Uint8Array): Promise<string> {
  const archive = await JSZip.loadAsync(bytes);
  const part = archive.file("word/comments.xml");
  return part ? part.async("string") : "";
}

async function documentXml(bytes: Uint8Array): Promise<string> {
  const archive = await JSZip.loadAsync(bytes);
  const part = archive.file("word/document.xml");
  if (!part) throw new Error("word/document.xml is missing");
  return part.async("string");
}

test("a comment the shell adds is a real Word comment in the file", async () => {
  const original = new Uint8Array(await readFile(samplePath));
  expect(await readDocumentComments(original)).toEqual([]);

  const blocks = await readDocumentBlocks(original);
  const heading = blocks.find((block) => block.text.includes("投标人基本情况"));
  if (!heading) throw new Error("The sample heading is missing");

  const commented = await addComments(original, [
    {
      blockIndex: heading.index,
      text: COMMENT_PROBE,
      quote: "投标人基本情况",
    },
  ]);

  // What another editor reads: the comment part, the author, and the anchor.
  const xml = await commentsXml(commented);
  expect(xml).toContain(COMMENT_PROBE);
  expect(xml).toContain('w:author="User"');
  expect(await documentXml(commented)).toContain("commentRangeStart");

  // And what the shell reads back.
  const read = await readDocumentComments(commented);
  expect(read.map((comment) => comment.text)).toEqual([COMMENT_PROBE]);
  expect(read[0]?.author).toBe("User");
});

test("a second comment is added without losing the first", async () => {
  const original = new Uint8Array(await readFile(samplePath));
  const blocks = await readDocumentBlocks(original);
  const first = blocks.find((block) => block.text.includes("投标人基本情况"));
  const second = blocks.find((block) => block.text.includes("投标人（盖章）"));
  if (!first || !second) throw new Error("The sample blocks are missing");

  const once = await addComments(original, [{ blockIndex: first.index, text: COMMENT_PROBE }]);
  const twice = await addComments(once, [{ blockIndex: second.index, text: SECOND_PROBE }]);

  const read = await readDocumentComments(twice);
  expect(read.map((comment) => comment.text)).toEqual([COMMENT_PROBE, SECOND_PROBE]);
  // Both ids have to be distinct, or the second marker points at the first entry.
  expect(new Set(read.map((comment) => comment.id)).size).toBe(2);
  expect(await commentsXml(twice)).toContain(SECOND_PROBE);
});

test("an edit and a comment travel together in one save", async () => {
  const original = new Uint8Array(await readFile(samplePath));
  const blocks = await readDocumentBlocks(original);
  const target = blocks.find((block) => block.text.includes("投标人基本情况"));
  if (!target) throw new Error("The sample heading is missing");

  const edited = await replaceParagraphText(original, {
    blockIndex: target.index,
    text: "改过的标题",
  });
  const commented = await addComments(edited, [{ blockIndex: target.index, text: COMMENT_PROBE }]);

  const after = await readDocumentBlocks(commented);
  expect(after[target.index]?.text).toBe("改过的标题");
  expect((await readDocumentComments(commented)).map((comment) => comment.text)).toEqual([
    COMMENT_PROBE,
  ]);
});
