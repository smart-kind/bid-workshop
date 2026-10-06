#!/usr/bin/env node
/**
 * Refresh the vendored genoffice packages from an upstream checkout.
 *
 * The packages live in this repository at vendor/genoffice/ and are checked in,
 * so `git clone && pnpm install && pnpm build` works with no upstream checkout
 * and no machine-local symlinks. Run this script after pulling upstream to
 * bring the copy forward: it is a plain file copy, so the result shows up in
 * `git status` and is reviewable like any other change.
 *
 * Usage:
 *   node scripts/sync-genoffice.mjs /path/to/gen-document/feat-workspace
 */

import { cpSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

const upstream = process.argv[2];
if (!upstream) {
  console.error("usage: node scripts/sync-genoffice.mjs /path/to/gen-document/feat-workspace");
  process.exit(2);
}

const upstreamPackages = join(resolve(upstream), "packages");
if (!existsSync(upstreamPackages)) {
  console.error(`no packages directory at ${upstreamPackages}`);
  process.exit(2);
}

/** The packages this project builds against. Keep in step with pnpm-workspace.yaml. */
const packages = [
  "docx-engine",
  "file-parse",
  "font-metrics",
  "html2docx",
  "i18n",
  "pptx-engine",
  "agent-core",
  "ai-provider",
  "workspace-harness",
  "xlsx-gateway",
];

const vendorDir = join(root, "vendor", "genoffice");
const skip = (source) =>
  source.includes("node_modules") || source.endsWith(".DS_Store") || source.endsWith(".log");

let copied = 0;
for (const name of packages) {
  const from = join(upstreamPackages, name);
  if (!existsSync(from)) {
    console.warn(`⚠  ${name}: not found at ${from}`);
    continue;
  }
  const to = join(vendorDir, name);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true, filter: (source) => !skip(source) });
  console.log(`✓  ${name}`);
  copied++;
}

// The licence travels with the code, and the packages' tsconfigs extend a base
// config that lives at the upstream repository root.
for (const file of ["LICENSE", "NOTICE", "LICENSE-UNICODE.txt", "tsconfig.base.json"]) {
  const from = join(resolve(upstream), file);
  if (existsSync(from)) cpSync(from, join(vendorDir, file));
}

// pptx-engine's tests reach for the validator beside `packages/` upstream, so
// the sibling layout has to hold here too.
const toolsFrom = join(resolve(upstream), "tools", "ooxml-validate");
if (existsSync(toolsFrom)) {
  const toolsTo = join(root, "vendor", "tools", "ooxml-validate");
  rmSync(toolsTo, { recursive: true, force: true });
  cpSync(toolsFrom, toolsTo, { recursive: true, filter: (source) => !skip(source) });
  console.log("✓  tools/ooxml-validate");
}

console.log(`\nSynced ${copied} packages into vendor/genoffice. Review with \`git status\`.`);
