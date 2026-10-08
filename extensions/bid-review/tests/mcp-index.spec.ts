import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { buildLedger, runHeader } from "../ledger";
import {
  describeRunCapabilities,
  readConfiguredMcpServers,
  readProfileMcp,
  resolveRunCapabilities,
} from "../mcp-index";

/** T-24: the profile references data sources; it never carries their credentials. */

async function workspace(profile: unknown, mcp?: unknown) {
  const root = await mkdtemp(join(tmpdir(), "bid-mcp-"));
  await mkdir(join(root, ".bid"), { recursive: true });
  await writeFile(join(root, ".bid", "workspace.json"), JSON.stringify(profile), "utf8");
  if (mcp !== undefined) {
    await mkdir(join(root, ".pi"), { recursive: true });
    await writeFile(join(root, ".pi", "mcp.json"), JSON.stringify(mcp), "utf8");
  }
  return root;
}

test("resolves the referenced servers against the workspace's own mcp.json", async () => {
  const root = await workspace(
    { schemaVersion: 1, capabilities: { mcp: ["company-kb", "price-db"] } },
    { mcpServers: { "company-kb": { command: "x" }, other: { url: "https://example.test" } } },
  );

  expect(await readProfileMcp(root)).toEqual(["company-kb", "price-db"]);
  expect(await readConfiguredMcpServers(root)).toEqual(["company-kb", "other"]);

  const resolved = await resolveRunCapabilities({ workspacePath: root });
  expect(resolved.servers).toEqual(["company-kb"]);
  // A referenced-but-unconfigured server is named, and its criteria are called out.
  expect(resolved.missing).toEqual(["price-db"]);
  expect(describeRunCapabilities(resolved)).toContain("本次可用数据源：company-kb");
  expect(describeRunCapabilities(resolved)).toContain("未配置的 MCP server：price-db");
  expect(describeRunCapabilities(resolved)).toContain("相关判据无法核对");
});

test("the profile is never a place credentials live", async () => {
  const root = await workspace(
    { schemaVersion: 1, capabilities: { mcp: ["company-kb"] } },
    { mcpServers: { "company-kb": { url: "https://kb.example.test", token: "secret" } } },
  );

  const profile = await readProfileMcp(root);
  const configured = await readConfiguredMcpServers(root);

  // The profile knows the name only; the token stays in mcp.json.
  expect(profile).toEqual(["company-kb"]);
  expect(configured).toEqual(["company-kb"]);
});

test("a workspace with no mcp.json reports every reference as missing", async () => {
  const root = await workspace({ schemaVersion: 1, capabilities: { mcp: ["a", "b"] } });

  expect(await readConfiguredMcpServers(root)).toEqual([]);
  expect(await resolveRunCapabilities({ workspacePath: root })).toEqual({
    servers: [],
    missing: ["a", "b"],
  });
  expect(
    await resolveRunCapabilities({ workspacePath: await mkdtemp(join(tmpdir(), "bid-mcp-")) }),
  ).toEqual({
    servers: [],
    missing: [],
  });
});

test("a finding can say which source it rested on", () => {
  const ledger = buildLedger(
    runHeader({
      runId: "run-1",
      startedAt: "2026-10-08T00:00:00.000Z",
      documentPath: "/w/书.docx",
      documentFingerprint: "abc",
    }),
    [
      {
        id: "F-1",
        severity: "warning",
        check: "资质文件齐全",
        verdict: "not-satisfied",
        problem: "缺少营业执照",
        sources: [{ kind: "mcp", name: "company-kb", at: "2026-10-08T00:00:00.000Z" }],
      },
      { id: "F-2", severity: "info", check: "格式", verdict: "satisfied" },
    ],
  );

  expect(ledger.findings[0]?.sources).toEqual([
    { kind: "mcp", name: "company-kb", at: "2026-10-08T00:00:00.000Z" },
  ]);
  expect(ledger.findings[1]?.sources).toBeUndefined();
});
