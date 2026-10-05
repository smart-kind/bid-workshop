import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

async function main() {
  const readme = await readFile(path.join(repoRoot, "README.md"), "utf8");

  assert.match(
    readme,
    /Download the latest `\.dmg` \(macOS\), `\.AppImage` or `\.deb` \(Linux\), or `\.exe` \(Windows\) from the\s+\[Releases page\]/,
  );
  assert.match(readme, /brew install --cask pi-gui/);
  assert.match(readme, /brew upgrade --cask pi-gui/);
  assert.doesNotMatch(readme, /Homebrew installation will be published/);

  process.stdout.write("Install copy is aligned with README.\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
