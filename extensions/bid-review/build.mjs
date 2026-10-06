import { build } from "esbuild";

// The two entries run in different places and need different treatment.
//
// desktop.ts is loaded by the desktop app inside an extension frame. That frame
// is served as a plain document with no import map, so it can only follow
// relative specifiers: any bare import left in the output fails to resolve and
// the whole module graph never executes. It therefore has to be bundled
// self-contained.
//
// index.ts is the Node-side entry, loaded from source by the host. Its
// dependencies (the document engine, the pi packages) resolve at runtime, so
// they stay external rather than being inlined into a node bundle.
//
// Splitting is off: a shared chunk between a browser bundle and a node bundle
// would drag node-only code into the frame.
await build({
  entryPoints: ["index.ts"],
  bundle: true,
  format: "esm",
  outdir: "dist",
  platform: "node",
  external: ["@earendil-works/*", "@bid-workshop/*", "@genoffice/*", "node:*"],
  splitting: false,
});

await build({
  entryPoints: ["desktop.ts", "document-desktop.ts"],
  bundle: true,
  format: "esm",
  outdir: "dist",
  platform: "browser",
  external: [],
  splitting: false,
});
