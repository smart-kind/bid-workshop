// Adapter for the vendored document engine.
//
// This is the only file in the extension that imports @genoffice/docx-engine.
// It is plain JavaScript on purpose: the engine is vendored as a machine-local
// symlink, so CI has nothing to resolve that specifier against, and a
// TypeScript file importing it could not be type-checked there. The pairing
// parser-docx.d.mts gives callers a typed surface, and ./document keeps
// everything else free of the engine. See docs/plan.md.
import { readFile } from "node:fs/promises";
import { parseDocx } from "@genoffice/docx-engine";

export const docxParser = {
  async parse(filePath) {
    const bytes = await readFile(filePath);
    const parsed = await parseDocx(new Uint8Array(bytes));
    return { parsed, size: bytes.byteLength };
  },
};
