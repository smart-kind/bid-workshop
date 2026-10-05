import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkContractAuthority, checkContractDeclarations } from "./check-contract-authority.mjs";

for (const name of [
  "@bid-workshop/session-driver",
  "@bid-workshop/session-driver/runtime-types",
  "@bid-workshop/catalogs",
  "@bid-workshop/*",
  "@*",
  "*",
]) {
  test(`rejects ambient contract substitute ${name}`, () => {
    const failures = checkContractDeclarations(
      "vendor.d.ts",
      `declare module "${name}" { export interface SessionDriver {} }`,
    );
    assert.equal(failures.length, 1);
    assert.match(failures[0], /vendor\.d\.ts:1:.*canonical workspace exports/);
  });
}

test("rejects module augmentation as another owned contract path", () => {
  assert.equal(
    checkContractDeclarations(
      "augmentation.ts",
      'export {}; declare module "@bid-workshop/session-driver" { interface SessionDriver { bypass(): void } }',
    ).length,
    1,
  );
});

test("accepts canonical definitions, imports, and unrelated external declarations", () => {
  assert.deepEqual(
    checkContractDeclarations(
      "types.ts",
      `
export interface SessionDriver { openSession(): void }
import type { SessionRef } from "@bid-workshop/session-driver";
declare module "untyped-vendor" { export const value: unknown }
declare module "*.png" { const url: string; export default url }
// declare module "@bid-workshop/catalogs" {}
`,
    ),
    [],
  );
});

test("repository guard rejects an untracked vendor declaration and accepts its replacement", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pi-gui-contract-guard-"));
  execFileSync("git", ["init", "--quiet", root]);
  const file = path.join(root, "packages/driver/src/vendor.d.ts");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    'declare module "@bid-workshop/session-driver" { export interface SessionDriver {} }',
  );
  assert.equal(checkContractAuthority(root).length, 1);
  writeFileSync(file, 'import type { SessionDriver } from "@bid-workshop/session-driver";');
  assert.deepEqual(checkContractAuthority(root), []);
});
