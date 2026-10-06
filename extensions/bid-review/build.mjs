import { build } from "esbuild";

await build({
  entryPoints: ["index.ts", "desktop.ts"],
  bundle: true,
  format: "esm",
  outdir: "dist",
  platform: "browser",
  external: [
    "@earendil-works/*",
    "@bid-workshop/*",
    // index.ts is the Node-side entry: it parses documents on disk, so the
    // node builtins and the genoffice packages must stay as runtime imports
    // instead of being bundled into a browser-targeted file.
    "@genoffice/*",
    "node:*",
  ],
  splitting: true,
});
