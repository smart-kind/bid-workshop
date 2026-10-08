import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { WorkspaceProfile } from "../../contracts/business-workspace";
import { WorkspaceProfileOwner } from "../../electron/workspace/workspace-profile";

async function makeWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "workspace-profile-"));
}

function profile(overrides: Partial<WorkspaceProfile> = {}): WorkspaceProfile {
  return {
    schemaVersion: 1,
    business: "bid-tender",
    zones: {
      reference: ["公司资料"],
      material: ["招标文件"],
      output: ["产出"],
      feedback: ["意见"],
    },
    skills: ["bid-qualification"],
    capabilities: { mcp: ["company-kb"] },
    delivery: { commentTarget: "copy", outputSuffix: "-批注", criteriaFile: "评审条件.md" },
    ...overrides,
  };
}

async function writeProfileFile(workspacePath: string, contents: string): Promise<string> {
  const path = join(workspacePath, ".bid", "workspace.json");
  await mkdir(join(workspacePath, ".bid"), { recursive: true });
  await writeFile(path, contents);
  return path;
}

test("reports a missing profile without throwing", async () => {
  const owner = new WorkspaceProfileOwner();
  const state = await owner.read(await makeWorkspace());

  expect(state.status).toBe("missing");
});

test("reads a valid profile and derives the workspace context", async () => {
  const owner = new WorkspaceProfileOwner();
  const workspace = await makeWorkspace();
  await writeProfileFile(
    workspace,
    JSON.stringify({
      schemaVersion: 1,
      business: "bid-tender",
      name: "投诉系统项目",
      zones: { material: ["招标文件"] },
      skills: ["bid-qualification"],
      capabilities: { mcp: ["company-kb"] },
    }),
  );

  const state = await owner.read(workspace);

  expect(state.status).toBe("ok");
  if (state.status !== "ok") return;
  expect(state.recoveredFromBackup).toBe(false);
  expect(state.context.business).toBe("bid-tender");
  expect(state.context.name).toBe("投诉系统项目");
  expect(state.context.zoned).toBe(true);
  expect(state.context.skills).toEqual(["bid-qualification"]);
  expect(state.context.mcp).toEqual(["company-kb"]);
  expect(state.context.delivery.commentTarget).toBe("copy");
  expect(state.zones.isReadOnlyPath("招标文件/书.docx")).toBe(true);
});

test("reports a flat profile as unzoned", async () => {
  const owner = new WorkspaceProfileOwner();
  const workspace = await makeWorkspace();
  await writeProfileFile(workspace, JSON.stringify({ schemaVersion: 1, business: "bid-tender" }));

  const state = await owner.read(workspace);

  expect(state.status).toBe("ok");
  if (state.status !== "ok") return;
  expect(state.context.zoned).toBe(false);
  expect(state.context.zones).toEqual({ reference: [], material: [], output: [], feedback: [] });
});

test("reports an unparsable profile without overwriting its bytes", async () => {
  const owner = new WorkspaceProfileOwner();
  const workspace = await makeWorkspace();
  const original = "{ this is not json";
  const path = await writeProfileFile(workspace, original);

  const state = await owner.read(workspace);
  expect(state.status).toBe("invalid");

  await expect(owner.write(workspace, profile())).rejects.toThrow(/Cannot overwrite invalid/);
  expect(await readFile(path, "utf8")).toBe(original);
});

test("marks a schema violation invalid and keeps the original bytes", async () => {
  const owner = new WorkspaceProfileOwner();
  const workspace = await makeWorkspace();
  const original = JSON.stringify({ schemaVersion: 2, business: "bid-tender" });
  const path = await writeProfileFile(workspace, original);

  const state = await owner.read(workspace);

  expect(state.status).toBe("invalid");
  if (state.status !== "invalid") return;
  expect(state.reason).toMatch(/unsupported schema version/);
  await expect(owner.write(workspace, profile())).rejects.toThrow(
    /Invalid workspace profile: unsupported schema version/,
  );
  expect(await readFile(path, "utf8")).toBe(original);
});

test("rebuild repairs a schema-invalid profile while preserving its bytes", async () => {
  const owner = new WorkspaceProfileOwner();
  const workspace = await makeWorkspace();
  const original = JSON.stringify({ schemaVersion: 99, business: "bid-tender" });
  const path = await writeProfileFile(workspace, original);

  await owner.rebuild(workspace, profile({ business: "rebuilt" }));

  const state = await owner.read(workspace);
  expect(state.status).toBe("ok");
  if (state.status !== "ok") return;
  expect(state.context.business).toBe("rebuilt");
  const preserved = (await readdir(join(workspace, ".bid"))).find((name) =>
    name.startsWith("workspace.json.corrupt-"),
  );
  expect(preserved).toBeDefined();
  expect(await readFile(join(workspace, ".bid", preserved ?? ""), "utf8")).toBe(original);
});

test("recovers the value from the backup when the primary is broken", async () => {
  const owner = new WorkspaceProfileOwner();
  const workspace = await makeWorkspace();
  const path = await writeProfileFile(workspace, "{ broken");
  await writeFile(`${path}.bak`, JSON.stringify({ schemaVersion: 1, business: "bid-tender" }));

  const state = await owner.read(workspace);

  expect(state.status).toBe("ok");
  if (state.status !== "ok") return;
  expect(state.recoveredFromBackup).toBe(true);
  expect(state.context.business).toBe("bid-tender");
});

test("writes atomically, retaining the previous version as .bak", async () => {
  const owner = new WorkspaceProfileOwner();
  const workspace = await makeWorkspace();

  await owner.write(workspace, profile({ business: "first" }));
  await owner.write(workspace, profile({ business: "second" }));

  const path = join(workspace, ".bid", "workspace.json");
  const written = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  expect(written.business).toBe("second");
  expect(Object.keys(written).sort()).toEqual([
    "business",
    "capabilities",
    "delivery",
    "schemaVersion",
    "skills",
    "zones",
  ]);
  const backup = JSON.parse(await readFile(`${path}.bak`, "utf8")) as Record<string, unknown>;
  expect(backup.business).toBe("first");
  expect((await readdir(join(workspace, ".bid"))).some((name) => name.endsWith(".tmp"))).toBe(
    false,
  );
});

test("rebuild preserves the damaged bytes and installs a fresh profile", async () => {
  const owner = new WorkspaceProfileOwner();
  const workspace = await makeWorkspace();
  const original = "{ broken beyond repair";
  const path = await writeProfileFile(workspace, original);

  await owner.rebuild(workspace, profile({ business: "rebuilt" }));

  const state = await owner.read(workspace);
  expect(state.status).toBe("ok");
  if (state.status !== "ok") return;
  expect(state.context.business).toBe("rebuilt");
  const entries = await readdir(join(workspace, ".bid"));
  const preserved = entries.find((name) => name.startsWith("workspace.json.corrupt-"));
  expect(preserved).toBeDefined();
  expect(await readFile(join(workspace, ".bid", preserved ?? ""), "utf8")).toBe(original);
});

test("refuses a profile whose zone declaration is not a plain relative path", async () => {
  const owner = new WorkspaceProfileOwner();
  const workspace = await makeWorkspace();

  await expect(
    owner.write(
      workspace,
      profile({ zones: { reference: ["../外部"], material: [], output: [], feedback: [] } }),
    ),
  ).rejects.toThrow(/Invalid workspace zones/);
});
