#!/usr/bin/env node
/**
 * Link genoffice core packages into vendor/genoffice/ as symlinks.
 *
 * Usage:
 *   node scripts/link-genoffice.mjs [path-to-genoffice]
 *
 * Default genoffice path: ../gen-document/feat-workspace
 * (i.e. sibling directory of bid-workshop)
 */

import { existsSync, mkdirSync, symlinkSync, unlinkSync, lstatSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");

const genofficeRoot = process.argv[2] ?? resolve(root, "../gen-document/feat-workspace");

const packages = [
  "docx-engine",
  "file-parse",
  "font-metrics",
  "html2docx",
  "i18n",
  "pptx-engine",
  // workspace-harness carries the workspace model, the document/comment tools
  // and the review-findings tool this project builds on; agent-core, ai-provider
  // and xlsx-gateway are its genoffice dependencies.
  "agent-core",
  "ai-provider",
  "workspace-harness",
  "xlsx-gateway",
];

const vendorDir = join(root, "vendor", "genoffice");
mkdirSync(vendorDir, { recursive: true });

let linked = 0;
let skipped = 0;

for (const pkg of packages) {
  const src = join(genofficeRoot, "packages", pkg);
  const dst = join(vendorDir, pkg);

  if (!existsSync(src)) {
    console.warn(`⚠  ${pkg}: source not found at ${src}`);
    skipped++;
    continue;
  }

  // Remove existing symlink or directory
  if (existsSync(dst) || lstatExistsSync(dst)) {
    unlinkSync(dst);
  }

  symlinkSync(src, dst);
  console.log(`✓  ${pkg} → ${relative(root, src)}`);
  linked++;
}

console.log(`\nDone: ${linked} linked, ${skipped} skipped`);

function lstatExistsSync(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}
