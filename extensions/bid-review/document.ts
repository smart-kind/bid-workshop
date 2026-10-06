import { basename } from "node:path";

/**
 * The document shape the review works on, described structurally rather than
 * by importing the document engine. The engine lives behind
 * {@link BidDocumentParser}, so this module stays free of that dependency and
 * can be type-checked and reasoned about on its own.
 */
export interface BidRun {
  text: string;
}

export interface BidCell {
  paras: string[];
}

export interface BidBlock {
  type: string;
  level?: number;
  hidden?: boolean;
  label?: string;
  runs?: BidRun[];
  table?: { rows: BidCell[][] };
}

export interface BidParsedDocument {
  blocks: BidBlock[];
}

/** A heading in the document, with the index of the block it lives in. */
export interface BidOutlineEntry {
  level: number;
  title: string;
  blockIndex: number;
}

/** A table, flattened to plain text so it can be handed to the model. */
export interface BidTableInfo {
  blockIndex: number;
  rows: number;
  cols: number;
  cells: string[][];
}

export interface LoadedBid {
  name: string;
  path: string;
  size: number;
  blockCount: number;
  tableCount: number;
  charCount: number;
  outline: BidOutlineEntry[];
  tables: BidTableInfo[];
  /** Whole document as text, in reading order. */
  text: string;
}

/**
 * Reads a .docx into the structural form above. Supplied by the host at
 * startup so this extension does not depend on a document engine directly.
 */
export interface BidDocumentParser {
  parse(filePath: string): Promise<{ parsed: BidParsedDocument; size: number }>;
}

let parser: BidDocumentParser | null = null;

/** Install the parser used by every later load. Called once, at extension setup. */
export function setBidDocumentParser(next: BidDocumentParser): void {
  parser = next;
}

export function hasBidDocumentParser(): boolean {
  return parser !== null;
}

function blockText(block: BidBlock): string {
  return (block.runs ?? []).map((run) => run.text).join("");
}

function tableCells(block: BidBlock): string[][] {
  return (block.table?.rows ?? []).map((row) => row.map((cell) => cell.paras.join(" ")));
}

function renderBlock(block: BidBlock): string {
  const text = blockText(block);
  switch (block.type) {
    case "heading":
      return `${"#".repeat(Math.min(block.level ?? 1, 6))} ${text}`;
    case "listItem":
      return `- ${text}`;
    case "table":
      return tableCells(block)
        .map((row) => row.join(" | "))
        .join("\n");
    case "image":
      return block.label ? `[图片：${block.label}]` : "[图片]";
    case "passthrough":
      return `[${block.label ?? "不可编辑内容"}]`;
    default:
      return text;
  }
}

/** Derive the outline, the tables and the plain text from a parsed document. */
function summarize(parsed: BidParsedDocument, filePath: string, size: number): LoadedBid {
  const visible = parsed.blocks.filter((block) => !block.hidden);

  const outline: BidOutlineEntry[] = [];
  const tables: BidTableInfo[] = [];
  visible.forEach((block, blockIndex) => {
    if (block.type === "heading") {
      outline.push({ level: block.level ?? 1, title: blockText(block), blockIndex });
    } else if (block.type === "table") {
      const cells = tableCells(block);
      tables.push({
        blockIndex,
        rows: cells.length,
        cols: cells.reduce((max, row) => Math.max(max, row.length), 0),
        cells,
      });
    }
  });

  const text = visible
    .map(renderBlock)
    .filter((line) => line.trim().length > 0)
    .join("\n");

  return {
    name: basename(filePath),
    path: filePath,
    size,
    blockCount: visible.length,
    tableCount: tables.length,
    charCount: text.length,
    outline,
    tables,
    text,
  };
}

/** Read a .docx through the installed parser and summarize it for review. */
export async function loadBidDocument(filePath: string): Promise<LoadedBid> {
  if (!parser) {
    throw new Error("尚未注册文档解析器：无法读取 .docx");
  }
  const { parsed, size } = await parser.parse(filePath);
  return summarize(parsed, filePath, size);
}

/** A heading-and-count summary, meant to be read by the model before the full text. */
export function describeBid(bid: LoadedBid): string {
  const lines = bid.outline.map((entry) => `${"  ".repeat(entry.level - 1)}- ${entry.title}`);
  return [
    `${bid.name}：${bid.blockCount} 个块，${bid.tableCount} 张表，正文 ${bid.charCount} 字`,
    lines.length > 0 ? `章节：\n${lines.join("\n")}` : "章节：未识别到标题",
  ].join("\n");
}
