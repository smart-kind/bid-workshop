import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;
const pathsProject = path.resolve(projectRoot, "tsconfig.paths.json");
const devPort = Number(process.env.PI_APP_DEV_PORT ?? "5173");
export default defineConfig(({ command }) => {
  const cleanOutputs = command === "build";

  return {
    main: {
      plugins: [tsconfigPaths({ projects: [pathsProject] })],
      build: {
        outDir: "out/main",
        externalizeDeps: {
          // Bundled instead of required at run time: these workspace packages ship
          // TypeScript sources (their `exports` point at src/*.ts), which Node cannot
          // load out of out/main. The document capability is the shell's own now, so
          // it travels inside the bundle.
          exclude: [
            "@earendil-works/chord",
            "@bid-workshop/extension-ui",
            "@bid-workshop/document-ai",
            "@bid-workshop/document-service",
            "@genoffice/ai-provider",
            "@genoffice/docx-engine",
            "@genoffice/pptx-engine",
          ],
        },
        emptyOutDir: cleanOutputs,
        rollupOptions: {
          input: {
            main: path.resolve(projectRoot, "electron/main.ts"),
          },
        },
      },
    },
    preload: {
      plugins: [tsconfigPaths({ projects: [pathsProject] })],
      build: {
        outDir: "out/preload",
        emptyOutDir: cleanOutputs,
        rollupOptions: {
          input: {
            preload: path.resolve(projectRoot, "electron/preload.ts"),
            "document-preload": path.resolve(projectRoot, "electron/document-preload.ts"),
          },
        },
      },
    },
    renderer: {
      root: projectRoot,
      base: "./",
      plugins: [react(), tsconfigPaths({ projects: [pathsProject] })],
      server: {
        port: devPort,
        strictPort: true,
      },
      build: {
        outDir: "out/renderer",
        emptyOutDir: true,
        rollupOptions: {
          input: path.resolve(projectRoot, "index.html"),
        },
      },
    },
  };
});
