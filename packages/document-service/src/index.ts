import { buildBlankDocx, parseDocx, saveDocx } from "@genoffice/docx-engine";
import type { Block, Run, SaveBlock, TableModel } from "@genoffice/docx-engine";

/**
 * The shell's own document capability, for `.docx` files that are not open in
 * the editor.
 *
 * The editor does this work in its renderer, against the document the user is
 * looking at. This serves the other case — an agent or a command that has to
 * read or produce a file on disk, with no window involved.
 *
 * It lives in its own package because the vendored engine ships TypeScript
 * sources: this project's tsconfig reads them, and the main process's does not
 * have to (see docs/shell-plan.md F3).
 *
 * Every edit follows one rule from the engine's own contract: a block is either
 * passed through byte-for-byte as `original`, or rebuilt as `generated` with
 * every formatting carrier copied over. Rebuilding a paragraph without its
 * `rawPPr` / `run.rawRPr` / style is how documents come back reformatted.
 */

/** Block types the engine can rebuild as a generated block. */
const REBUILDABLE = new Set(["paragraph", "heading", "listItem"]);

type GeneratedParagraph = Extract<SaveBlock, { kind: "generated" }>["block"];

export interface DocumentParagraph {
  readonly text: string;
  /** a heading level makes this a heading; absent means a body paragraph */
  readonly level?: number;
}

/** One addressable block, with the index every edit below expects. */
export interface DocumentBlockRef {
  readonly index: number;
  readonly type: string;
  readonly level?: number;
  readonly text: string;
}

/** The document's text, one line per block, tables rendered as their rows. */
export async function readDocumentText(bytes: Uint8Array): Promise<string> {
  const parsed = await parseDocx(bytes);
  return visibleBlocks(parsed)
    .map(blockText)
    .filter((line) => line.trim() !== "")
    .join("\n");
}

/** The blocks an edit can address, in document order. */
export async function readDocumentBlocks(bytes: Uint8Array): Promise<DocumentBlockRef[]> {
  const parsed = await parseDocx(bytes);
  return visibleBlocks(parsed).map((block, index) => ({
    index,
    type: block.type,
    ...(block.level === undefined ? {} : { level: block.level }),
    text: blockText(block),
  }));
}

/** A new document holding these paragraphs, in order. */
export async function createDocument(
  paragraphs: readonly DocumentParagraph[],
): Promise<Uint8Array> {
  const blank = await parseDocx(await buildBlankDocx());
  const saveBlocks: SaveBlock[] = paragraphs.map((paragraph) => ({
    kind: "generated",
    block: paragraphBlock(paragraph),
  }));
  return saveDocx(blank, saveBlocks);
}

export interface InsertParagraphOptions {
  readonly paragraph: DocumentParagraph;
  /** insert after this block index; omitted puts it at the end */
  readonly afterBlockIndex?: number;
}

/** The same document with one paragraph added. */
export async function insertParagraph(
  bytes: Uint8Array,
  options: InsertParagraphOptions,
): Promise<Uint8Array> {
  const parsed = await parseDocx(bytes);
  const blocks = visibleBlocks(parsed);
  const at = options.afterBlockIndex === undefined ? blocks.length : options.afterBlockIndex + 1;
  if (at < 0 || at > blocks.length) {
    throw new Error(
      `afterBlockIndex ${String(options.afterBlockIndex)} is out of range ` +
        `(0..${blocks.length - 1}, or omitted for the end)`,
    );
  }
  const saveBlocks: SaveBlock[] = blocks.map(passThrough);
  saveBlocks.splice(at, 0, { kind: "generated", block: paragraphBlock(options.paragraph) });
  return saveDocx(parsed, saveBlocks);
}

export interface ReplaceParagraphOptions {
  readonly blockIndex: number;
  readonly text: string;
}

/**
 * The same document with one block's text replaced. The block keeps its own
 * formatting: the replacement run carries the first run's properties, and the
 * paragraph keeps its style, list and raw property XML.
 */
export async function replaceParagraphText(
  bytes: Uint8Array,
  options: ReplaceParagraphOptions,
): Promise<Uint8Array> {
  const parsed = await parseDocx(bytes);
  const blocks = visibleBlocks(parsed);
  const target = blocks[options.blockIndex];
  if (!target) {
    throw new Error(`blockIndex ${options.blockIndex} is out of range (0..${blocks.length - 1})`);
  }
  if (!REBUILDABLE.has(target.type)) {
    throw new Error(
      `block ${options.blockIndex} is a ${target.type}; only paragraphs, headings and ` +
        `list items can be retyped`,
    );
  }
  const runs: Run[] = [{ ...(target.runs?.[0] ?? { text: "" }), text: options.text }];
  const saveBlocks: SaveBlock[] = blocks.map((block, index) =>
    index === options.blockIndex
      ? { kind: "generated", block: asGenerated(block, runs) }
      : passThrough(block),
  );
  return saveDocx(parsed, saveBlocks);
}

function visibleBlocks(parsed: { blocks?: Block[] }): Block[] {
  return (parsed.blocks ?? []).filter((block) => !block.hidden);
}

function passThrough(block: Block): SaveBlock {
  return block.docxIndex === null
    ? { kind: "generated", block: asGenerated(block) }
    : { kind: "original", docxIndex: block.docxIndex };
}

/** One parsed block, rebuilt, carrying every field that holds formatting. */
function asGenerated(block: Block, runs: Run[] = block.runs ?? []): GeneratedParagraph {
  const generated: GeneratedParagraph = { type: block.type as "paragraph", runs };
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

function paragraphBlock(paragraph: DocumentParagraph): GeneratedParagraph {
  const runs: Run[] = [{ text: paragraph.text }];
  return paragraph.level === undefined
    ? { type: "paragraph", runs }
    : { type: "heading", level: paragraph.level, runs };
}

function blockText(block: Block): string {
  if (block.table) return tableText(block.table);
  return (block.runs ?? [])
    .map((run) => run.text)
    .join("")
    .trimEnd();
}

function tableText(table: TableModel): string {
  return table.rows
    .map((row) => row.map((cell) => cell.paras.join(" ").trim()).join(" | "))
    .join("\n");
}
