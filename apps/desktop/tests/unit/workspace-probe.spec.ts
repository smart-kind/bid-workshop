import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { decodeWorkspaceProfile } from "../../contracts/business-workspace";
import { createZoneResolver } from "../../contracts/workspace-zones";
import { probeBusinessWorkspace } from "../../electron/workspace/workspace-probe";

async function makeWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "workspace-probe-"));
}

async function writeFileAt(workspacePath: string, relative: string, contents = ""): Promise<void> {
  const path = join(workspacePath, relative);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, contents);
}

test("an empty folder offers nothing and still yields a valid flat profile", async () => {
  const probe = await probeBusinessWorkspace(await makeWorkspace());

  expect(probe.looksLikeBusiness).toBe(false);
  expect(probe.documents).toEqual([]);
  expect(probe.criteriaFile).toBeUndefined();
  expect(probe.zoneDirectories).toEqual([]);
  expect(probe.proposedProfile.zones).toEqual({
    reference: [],
    material: [],
    output: [],
    feedback: [],
  });
  expect(probe.proposedProfile.delivery.criteriaFile).toBe("评审条件.md");
  expect(() => decodeWorkspaceProfile(probe.proposedProfile)).not.toThrow();
  expect(createZoneResolver(probe.proposedProfile.zones).isZoned).toBe(false);
});

test("finds documents, the criteria file and the recommended folders", async () => {
  const workspace = await makeWorkspace();
  await writeFileAt(workspace, "评审条件.md", "# 评审条件");
  await writeFileAt(workspace, "招标书.docx");
  await writeFileAt(workspace, "投标文件.docx");
  await writeFileAt(workspace, "公司资料/营业执照.docx");
  await mkdir(join(workspace, "招标文件"), { recursive: true });
  await mkdir(join(workspace, "产出"), { recursive: true });
  await mkdir(join(workspace, "意见"), { recursive: true });

  const probe = await probeBusinessWorkspace(workspace);

  expect(probe.looksLikeBusiness).toBe(true);
  expect(probe.criteriaFile).toBe("评审条件.md");
  expect(probe.documents).toEqual(
    expect.arrayContaining(["招标书.docx", "投标文件.docx", "公司资料/营业执照.docx"]),
  );
  expect(probe.zoneDirectories).toEqual(["公司资料", "招标文件", "产出", "意见"]);
  expect(probe.proposedProfile.zones).toEqual({
    reference: ["公司资料"],
    material: ["招标文件"],
    output: ["产出"],
    feedback: ["意见"],
  });
  const resolver = createZoneResolver(probe.proposedProfile.zones);
  expect(resolver.isReadOnlyPath("招标文件/招标书.docx")).toBe(true);
  expect(resolver.isReadOnlyPath("产出/投标文件-批注.docx")).toBe(false);
});

test("a criteria file alone is enough to look like a bid workspace", async () => {
  const workspace = await makeWorkspace();
  await writeFileAt(workspace, "评分办法.txt", "评分办法");

  const probe = await probeBusinessWorkspace(workspace);

  expect(probe.looksLikeBusiness).toBe(true);
  expect(probe.criteriaFile).toBe("评分办法.txt");
  expect(probe.proposedProfile.delivery.criteriaFile).toBe("评分办法.txt");
});

test("ignores hidden, vendored and build directories", async () => {
  const workspace = await makeWorkspace();
  await writeFileAt(workspace, ".git/objects/old.docx");
  await writeFileAt(workspace, ".bid/note.docx");
  await writeFileAt(workspace, "node_modules/pkg/readme.docx");
  await writeFileAt(workspace, "dist/out.docx");
  await writeFileAt(workspace, "顶层.docx");

  const probe = await probeBusinessWorkspace(workspace);

  expect(probe.documents).toEqual(["顶层.docx"]);
});

test("only the root criteria file counts", async () => {
  const workspace = await makeWorkspace();
  await writeFileAt(workspace, "产出/评审条件.md", "# nested");

  const probe = await probeBusinessWorkspace(workspace);

  expect(probe.criteriaFile).toBeUndefined();
  expect(probe.looksLikeBusiness).toBe(false);
});

test("caps the document list", async () => {
  const workspace = await makeWorkspace();
  for (let index = 0; index < 25; index += 1) {
    await writeFileAt(workspace, `文件-${index}.docx`);
  }

  const probe = await probeBusinessWorkspace(workspace);

  expect(probe.documents).toHaveLength(20);
  expect(probe.looksLikeBusiness).toBe(true);
});
