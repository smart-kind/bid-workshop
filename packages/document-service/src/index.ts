import { parseDocx } from "@genoffice/docx-engine";
import type { Block, TableModel } from "@genoffice/docx-engine";

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
 */

/** The document's text, one line per block, tables rendered as their rows. */
export async function readDocumentText(bytes: Uint8Array): Promise<string> {
  const parsed = await parseDocx(bytes);
  return (parsed.blocks ?? [])
    .map(blockText)
    .filter((line) => line.trim() !== "")
    .join("\n");
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
