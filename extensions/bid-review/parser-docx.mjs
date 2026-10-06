// Adapter for the vendored document engine.
//
// This is the only file in the extension that imports @genoffice/docx-engine.
// It is plain JavaScript on purpose: the engine is vendored as a machine-local
// symlink, so CI has nothing to resolve that specifier against, and a
// TypeScript file importing it could not be type-checked there. The pairing
// parser-docx.d.mts gives callers a typed surface, and ./document keeps
// everything else free of the engine. See docs/plan.md.
import { readFile, writeFile } from "node:fs/promises";
import { parseDocx, saveDocx } from "@genoffice/docx-engine";

/** Block types the engine can rebuild as a generated paragraph. */
const REGENERABLE = new Set(["paragraph", "heading", "listItem"]);

/** Inclusive run indexes covering `quote`, or null to mean "the whole block". */
function runRange(runs, quote) {
  if (!quote) return null;
  const full = runs.map((run) => run.text).join("");
  const at = full.indexOf(quote);
  if (at < 0) return null;
  const last = at + quote.length - 1;

  let cursor = 0;
  let first = -1;
  let final = -1;
  for (let i = 0; i < runs.length; i++) {
    const start = cursor;
    const end = cursor + runs[i].text.length - 1;
    if (first < 0 && at <= end) first = i;
    if (start <= last) final = i;
    cursor += runs[i].text.length;
  }
  if (first < 0 || final < 0 || final < first) return null;
  return [first, final];
}

/**
 * Rebuild one parsed block as a generated block, copying every field that
 * carries formatting so the paragraph comes back byte-faithful, then tag the
 * runs the comment covers.
 */
function toGenerated(block, anchored) {
  const runs = (block.runs ?? []).map((run) => ({ ...run }));

  for (const comment of anchored) {
    const range = runRange(runs, comment.quote);
    const first = range ? range[0] : 0;
    const last = range ? range[1] : runs.length - 1;
    for (let i = first; i <= last; i++) {
      const run = runs[i];
      if (!run) continue;
      run.commentIds = [...(run.commentIds ?? []), comment.commentId];
    }
  }

  const generated = { type: block.type, runs };
  if (block.level !== undefined) generated.level = block.level;
  if (block.outlineOnly !== undefined) generated.outlineOnly = block.outlineOnly;
  if (block.styleId !== undefined) generated.styleId = block.styleId;
  if (block.list !== undefined) generated.list = block.list;
  if (block.format !== undefined) generated.format = block.format;
  if (block.rawPPr !== undefined) generated.rawPPr = block.rawPPr;
  if (block.bookmarks !== undefined) generated.bookmarks = block.bookmarks;
  if (block.hiddenBookmarks !== undefined) generated.hiddenBookmarks = block.hiddenBookmarks;
  if (block.sdtShell !== undefined) generated.sdtShell = block.sdtShell;
  return generated;
}

export const docxParser = {
  async parse(filePath) {
    const bytes = await readFile(filePath);
    const parsed = await parseDocx(new Uint8Array(bytes));
    return { parsed, size: bytes.byteLength };
  },
};

export const docxCommentWriter = {
  async write({ sourcePath, outputPath, comments }) {
    const bytes = await readFile(sourcePath);
    const parsed = await parseDocx(new Uint8Array(bytes));
    const visible = parsed.blocks.filter((block) => !block.hidden);

    // Comments whose block cannot hold an anchor are dropped, not misplaced.
    // Markers in the document and entries in comments.xml must carry the SAME
    // id: a marker whose id has no entry is dropped on save. Word's w:id is a
    // decimal number, so number the comments and keep the finding id alongside.
    const byBlock = new Map();
    const skipped = [];
    const numbered = [];
    for (const comment of comments) {
      const block = visible[comment.blockIndex];
      if (!block || !REGENERABLE.has(block.type)) {
        skipped.push(comment.id);
        continue;
      }
      const withId = { ...comment, commentId: String(numbered.length + 1) };
      numbered.push(withId);
      const group = byBlock.get(comment.blockIndex) ?? [];
      group.push(withId);
      byBlock.set(comment.blockIndex, group);
    }

    const saveBlocks = visible.map((block, index) => {
      const anchored = byBlock.get(index);
      if (!anchored) return { kind: "original", docxIndex: block.docxIndex };
      return { kind: "generated", block: toGenerated(block, anchored) };
    });

    const commentInfos = numbered.map((comment) => {
      const info = {
        id: comment.commentId,
        author: comment.author,
        text: comment.text,
      };
      if (comment.date) info.date = comment.date;
      return info;
    });

    const out = await saveDocx(parsed, saveBlocks, { comments: commentInfos });
    await writeFile(outputPath, out);
    return {
      outputPath,
      written: commentInfos.length,
      skipped,
      ids: numbered.map((comment) => ({ finding: comment.id, comment: comment.commentId })),
    };
  },
};
