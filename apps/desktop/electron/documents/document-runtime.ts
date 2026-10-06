import { readFile, stat, writeFile } from "node:fs/promises";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  createDocument as buildDocument,
  insertParagraph as insertParagraphInto,
  readDocumentBlocks,
  replaceParagraphText as replaceBlockText,
  type DocumentBlockRef,
  type DocumentParagraph,
} from "@bid-workshop/document-service";
import { resolveWorkspacePath } from "../platform/files/workspace-paths";

/**
 * The shell's document tools: the other half of `@bid-workshop/document-service`.
 *
 * It reads and writes `.docx` files in the thread's own folder, with no editor
 * open, so an agent can produce or change a Word document the way it would any
 * other file. Paths are resolved against `ctx.cwd` and refused if they leave it:
 * an agent works inside the folder the user opened, not wherever it likes.
 *
 * Block indexes come from `read_docx` and move as edits land, so every update
 * response returns the document's blocks again.
 */

export const readDocumentToolName = "read_docx";
export const createDocumentToolName = "create_docx";
export const updateDocumentToolName = "update_docx";

export interface DocumentToolDetails {
  readonly action: string;
  readonly path?: string;
  readonly blockCount?: number;
  readonly blocks?: readonly DocumentBlockRef[];
  readonly error?: string;
}

type DocumentOperation =
  | {
      readonly kind: "insert";
      readonly text: string;
      readonly level?: number;
      readonly afterBlockIndex?: number;
    }
  | { readonly kind: "replace"; readonly blockIndex: number; readonly text: string };

export function createDocumentRuntimeTools(): ToolDefinition<any, DocumentToolDetails>[] {
  return [createReadTool(), createCreateTool(), createUpdateTool()];
}

export function createDocumentRuntimeExtension(): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    for (const tool of createDocumentRuntimeTools()) {
      pi.registerTool(tool);
    }
  };
}

function createReadTool(): ToolDefinition<any, DocumentToolDetails> {
  return {
    name: readDocumentToolName,
    label: "Read a Word document",
    description:
      "Read a .docx from the thread's folder and list its blocks with the indexes edits use.",
    promptSnippet: "read_docx: read a .docx and list its blocks with their indexes.",
    promptGuidelines: [
      "Read the document before changing it: the block indexes come from here.",
      "Indexes shift after every insert, so read again rather than reusing old ones.",
    ],
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "The .docx, relative to the thread's folder." },
      },
      required: ["path"],
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = readParams(params);
      if (!input) return failure("read_docx", "read_docx requires a non-empty path");
      try {
        const path = documentPath(ctx, input.path);
        const blocks = await readDocumentBlocks(new Uint8Array(await readFile(path)));
        return {
          content: [{ type: "text", text: formatBlocks(blocks) }],
          details: {
            action: readDocumentToolName,
            path,
            blockCount: blocks.length,
            blocks,
          },
        };
      } catch (error) {
        return failure("read_docx", messageOf(error));
      }
    },
  };
}

function createCreateTool(): ToolDefinition<any, DocumentToolDetails> {
  return {
    name: createDocumentToolName,
    label: "Create a Word document",
    description: "Write a new .docx into the thread's folder from paragraphs and headings.",
    promptSnippet: "create_docx: write a new .docx from paragraphs.",
    promptGuidelines: [
      "An existing file is never overwritten: pick another name or update it instead.",
      "Set level to make a heading (1 is the top level); leave it out for body text.",
    ],
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Where to write it, relative to the thread's folder.",
        },
        paragraphs: {
          type: "array",
          description: "The document's paragraphs, in order.",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              level: { type: "number", description: "Heading level 1-9; omit for body text." },
            },
            required: ["text"],
          },
        },
      },
      required: ["path", "paragraphs"],
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = createParams(params);
      if (!input) {
        return failure("create_docx", "create_docx requires a path and a paragraphs array");
      }
      try {
        const path = documentPath(ctx, input.path);
        if (await fileExists(path)) {
          return failure("create_docx", `${input.path} already exists`);
        }
        await writeFile(path, await buildDocument(input.paragraphs));
        return {
          content: [
            {
              type: "text",
              text: `Created ${input.path} with ${input.paragraphs.length} paragraph(s).`,
            },
          ],
          details: { action: createDocumentToolName, path, blockCount: input.paragraphs.length },
        };
      } catch (error) {
        return failure("create_docx", messageOf(error));
      }
    },
  };
}

function createUpdateTool(): ToolDefinition<any, DocumentToolDetails> {
  return {
    name: updateDocumentToolName,
    label: "Change a Word document",
    description:
      "Apply edits to a .docx in the thread's folder: replace a block's text, or insert a paragraph after a block.",
    promptSnippet: "update_docx: replace a block's text or insert a paragraph, then re-read.",
    promptGuidelines: [
      "Operations run in order, and an insert shifts the indexes after it.",
      "Use read_docx first: blockIndex and afterBlockIndex are the indexes it returned.",
    ],
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "The .docx, relative to the thread's folder." },
        operations: {
          type: "array",
          description: "Edits to apply, in order.",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", description: '"replace" or "insert".' },
              blockIndex: { type: "number", description: 'For "replace": the block to retype.' },
              text: { type: "string", description: "The new text." },
              level: { type: "number", description: 'For "insert": heading level, omit for body.' },
              afterBlockIndex: {
                type: "number",
                description: 'For "insert": put it after this block; omit for the end.',
              },
            },
            required: ["kind", "text"],
          },
        },
      },
      required: ["path", "operations"],
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = updateParams(params);
      if (!input) {
        return failure(
          "update_docx",
          'update_docx requires a path and operations with kind "replace" or "insert"',
        );
      }
      try {
        const path = documentPath(ctx, input.path);
        let bytes: Uint8Array = new Uint8Array(await readFile(path));
        for (const operation of input.operations) {
          bytes =
            operation.kind === "replace"
              ? await replaceBlockText(bytes, {
                  blockIndex: operation.blockIndex,
                  text: operation.text,
                })
              : await insertParagraphInto(bytes, {
                  paragraph: paragraphOf(operation),
                  ...(operation.afterBlockIndex === undefined
                    ? {}
                    : { afterBlockIndex: operation.afterBlockIndex }),
                });
        }
        await writeFile(path, bytes);
        const blocks = await readDocumentBlocks(bytes);
        return {
          content: [
            {
              type: "text",
              text: `Applied ${input.operations.length} operation(s).\n\n${formatBlocks(blocks)}`,
            },
          ],
          details: {
            action: updateDocumentToolName,
            path,
            blockCount: blocks.length,
            blocks,
          },
        };
      } catch (error) {
        return failure("update_docx", messageOf(error));
      }
    },
  };
}

function paragraphOf(operation: {
  readonly text: string;
  readonly level?: number;
}): DocumentParagraph {
  return operation.level === undefined
    ? { text: operation.text }
    : { text: operation.text, level: operation.level };
}

/** Resolved inside the thread's folder; anything that escapes it is refused. */
function documentPath(ctx: ExtensionContext, raw: string): string {
  return resolveWorkspacePath(ctx.cwd, raw);
}

function formatBlocks(blocks: readonly DocumentBlockRef[]): string {
  if (blocks.length === 0) return "The document has no blocks.";
  return blocks
    .map((block) => {
      const level = block.level === undefined ? "" : `(h${block.level})`;
      return `[${block.index}] ${block.type}${level}: ${block.text}`;
    })
    .join("\n");
}

function failure(action: string, message: string): AgentToolResult<DocumentToolDetails> {
  return {
    content: [{ type: "text", text: message }],
    details: { action, error: message },
    isError: true,
  };
}

function readParams(raw: unknown): { readonly path: string } | undefined {
  if (typeof raw !== "object" || raw === null || !("path" in raw)) return undefined;
  const path = (raw as { path?: unknown }).path;
  return typeof path === "string" && path !== "" ? { path } : undefined;
}

function createParams(
  raw: unknown,
): { readonly path: string; readonly paragraphs: DocumentParagraph[] } | undefined {
  const path = readParams(raw)?.path;
  if (!path || !("paragraphs" in (raw as object))) return undefined;
  const paragraphs = (raw as { paragraphs?: unknown }).paragraphs;
  if (!Array.isArray(paragraphs) || paragraphs.length === 0) return undefined;
  const parsed: DocumentParagraph[] = [];
  for (const entry of paragraphs) {
    if (typeof entry !== "object" || entry === null || !("text" in entry)) return undefined;
    const text = (entry as { text?: unknown }).text;
    if (typeof text !== "string") return undefined;
    const level = (entry as { level?: unknown }).level;
    parsed.push(typeof level === "number" && Number.isInteger(level) ? { text, level } : { text });
  }
  return { path, paragraphs: parsed };
}

function updateParams(
  raw: unknown,
): { readonly path: string; readonly operations: DocumentOperation[] } | undefined {
  const path = readParams(raw)?.path;
  if (!path || typeof raw !== "object" || raw === null || !("operations" in raw)) return undefined;
  const operations = (raw as { operations?: unknown }).operations;
  if (!Array.isArray(operations) || operations.length === 0) return undefined;
  const parsed: DocumentOperation[] = [];
  for (const entry of operations) {
    if (typeof entry !== "object" || entry === null) return undefined;
    const { kind, text } = entry as { kind?: unknown; text?: unknown };
    if (typeof text !== "string" || text === "") return undefined;
    if (kind === "replace") {
      const blockIndex = (entry as { blockIndex?: unknown }).blockIndex;
      if (typeof blockIndex !== "number" || !Number.isInteger(blockIndex)) return undefined;
      parsed.push({ kind: "replace", blockIndex, text });
      continue;
    }
    if (kind === "insert") {
      const level = (entry as { level?: unknown }).level;
      const afterBlockIndex = (entry as { afterBlockIndex?: unknown }).afterBlockIndex;
      parsed.push({
        kind: "insert",
        text,
        ...(typeof level === "number" && Number.isInteger(level) ? { level } : {}),
        ...(typeof afterBlockIndex === "number" && Number.isInteger(afterBlockIndex)
          ? { afterBlockIndex }
          : {}),
      });
      continue;
    }
    return undefined;
  }
  return { path, operations: parsed };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether the file is already there; keeps create from overwriting a document. */
async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
