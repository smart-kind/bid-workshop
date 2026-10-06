import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

// The vendored @genoffice/docx-engine ships raw TypeScript with extensionless
// internal imports behind a node_modules symlink, so the bundle has to be
// pointed at its sources explicitly.
const docxEngine = path.resolve(packageRoot, "../../vendor/genoffice/docx-engine/src");
const alias = {
  "@genoffice/docx-engine/lazy-media": path.join(docxEngine, "lazy-media.ts"),
  "@genoffice/docx-engine/zip-splice": path.join(docxEngine, "zip-splice.ts"),
  "@genoffice/docx-engine": path.join(docxEngine, "index.ts"),
};

export default defineConfig({
  root: path.join(packageRoot, "src/renderer"),
  // Relative asset URLs so the bundle can be served from any origin root.
  base: "./",
  plugins: [react()],
  resolve: { alias },
  build: {
    outDir: path.join(packageRoot, "dist"),
    emptyOutDir: true,
  },
});
