import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// The extension's browser bundles are checked in, the same way the desktop
// extension examples check theirs in: the frame is served from disk with no
// build step at run time, so a clone has to have them. `--check` fails when a
// committed bundle no longer matches its source.
//
// index.ts is deliberately not built: the host loads the extension from its
// source, and nothing reads a compiled dist/index.js.
const directory = fileURLToPath(new URL(".", import.meta.url));
const check = process.argv.includes("--check");

const entries = ["desktop", "document-desktop"];
const stale = [];

for (const name of entries) {
  const result = await build({
    absWorkingDir: directory,
    entryPoints: [`${name}.ts`],
    outfile: `dist/${name}.js`,
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    minify: true,
    legalComments: "none",
    sourcemap: false,
    write: !check,
  });
  if (check) {
    const committed = await readFile(new URL(`./dist/${name}.js`, import.meta.url));
    if (!committed.equals(Buffer.from(result.outputFiles[0].contents))) stale.push(name);
  }
}

if (check) {
  if (stale.length > 0) {
    throw new Error(
      `bid-review browser bundle is stale (${stale.join(", ")}). Run node extensions/bid-review/build.mjs`,
    );
  }
  console.log("bid-review browser bundles match their source.");
}
