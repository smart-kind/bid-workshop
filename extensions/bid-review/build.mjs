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
  ],
  splitting: true,
});
