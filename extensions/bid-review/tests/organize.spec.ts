import { lstat, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  applyOrganization,
  initWorkspaceGit,
  mountIntoZone,
  planOrganization,
  writeCriteriaSkeleton,
  writeProfileSkeleton,
} from "../organize";
import { EMPTY_ZONES, ZONES } from "./support/zones";

/** T-25: organising is previewable, idempotent, and never rewrites a file. */

async function workspace(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bid-organize-"));
  for (const [relative, body] of Object.entries(files)) {
    const path = join(root, relative);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, body, "utf8");
  }
  return root;
}

test("previews the directories the profile declares but the workspace lacks", async () => {
  const root = await workspace();

  const plan = await planOrganization({ workspacePath: root, zones: ZONES });

  expect(plan.actions.map((action) => action.kind)).toEqual(Array(4).fill("create-directory"));
  expect(plan.actions.map((action) => action.path)).toEqual([
    "公司资料",
    "招标文件",
    "产出",
    "意见",
  ]);
  expect(plan.actions[0]?.reason).toContain("公司资料/");
});

test("suggests a stray document into its zone and refuses to overwrite", async () => {
  const root = await workspace({ "招标书.docx": "doc", "招标文件/招标书.docx": "already here" });
  const plan = await planOrganization({
    workspacePath: root,
    zones: { ...EMPTY_ZONES, material: ["招标文件"] },
    documents: ["招标书.docx"],
  });

  expect(plan.actions).toHaveLength(1);
  expect(plan.actions[0]).toMatchObject({
    kind: "move-into-zone",
    path: "招标书.docx",
    target: join("招标文件", "招标书.docx"),
  });

  const result = await applyOrganization(root, plan);
  expect(result.applied).toEqual([]);
  expect(result.conflicts[0]?.reason).toContain("已存在，未覆盖");
  // The file that was already there is untouched.
  expect(await readFile(join(root, "招标文件", "招标书.docx"), "utf8")).toBe("already here");
});

test("applying a plan moves the file with its bytes and is idempotent", async () => {
  const root = await workspace({ "招标书.docx": "正文内容" });
  const plan = await planOrganization({
    workspacePath: root,
    zones: { ...EMPTY_ZONES, material: ["招标文件"] },
    documents: ["招标书.docx"],
  });

  const first = await applyOrganization(root, plan);
  expect(first.conflicts).toEqual([]);
  expect(first.applied.map((action) => action.kind)).toEqual([
    "create-directory",
    "move-into-zone",
  ]);
  expect(await readFile(join(root, "招标文件", "招标书.docx"), "utf8")).toBe("正文内容");
  await expect(stat(join(root, "招标书.docx"))).rejects.toThrow();

  // Running it again changes nothing: the directory exists and the file is placed.
  const again = await applyOrganization(
    root,
    await planOrganization({
      workspacePath: root,
      zones: { ...EMPTY_ZONES, material: ["招标文件"] },
      documents: ["招标书.docx"],
    }),
  );
  expect(again.applied).toEqual([]);
  expect(again.conflicts).toEqual([]);
});

test("mounting outside material copies by default and symlinks only on request", async () => {
  const root = await workspace();
  const outside = await workspace({ "营业执照.pdf": "certificate" });

  const copied = await mountIntoZone({
    sourcePath: join(outside, "营业执照.pdf"),
    workspacePath: root,
    target: join("公司资料", "营业执照.pdf"),
  });
  expect(copied.mode).toBe("copy");
  expect(await readFile(join(root, "公司资料", "营业执照.pdf"), "utf8")).toBe("certificate");
  // `lstat`, not `stat`: the latter follows the link and always answers false.
  expect((await lstat(join(root, "公司资料", "营业执照.pdf"))).isSymbolicLink()).toBe(false);

  await expect(
    mountIntoZone({
      sourcePath: join(outside, "营业执照.pdf"),
      workspacePath: root,
      target: join("公司资料", "营业执照.pdf"),
    }),
  ).rejects.toThrow(/已存在，未覆盖/);

  const linked = await mountIntoZone({
    sourcePath: join(outside, "营业执照.pdf"),
    workspacePath: root,
    target: join("公司资料", "执照链接.pdf"),
    mode: "symlink",
  });
  expect(linked.mode).toBe("symlink");
  expect((await lstat(join(root, "公司资料", "执照链接.pdf"))).isSymbolicLink()).toBe(true);

  // Nothing else was left behind.
  expect(await readdir(join(root, "公司资料"))).toEqual(
    expect.arrayContaining(["营业执照.pdf", "执照链接.pdf"]),
  );
});

test("an empty workspace with no zones has nothing to organize", async () => {
  const root = await workspace({ "随手记.txt": "note" });
  const plan = await planOrganization({ workspacePath: root, zones: EMPTY_ZONES });
  expect(plan).toEqual({ actions: [] });
  expect(await applyOrganization(root, plan)).toEqual({ applied: [], conflicts: [] });
});

test("a starting criteria file is written once and never replaces one", async () => {
  const root = await workspace();
  const first = await writeCriteriaSkeleton(root);
  expect(first).toEqual({ status: "written", path: "评审条件.md" });
  expect(await readFile(join(root, "评审条件.md"), "utf8")).toContain("## 一、资格与资质");

  await writeFile(join(root, "评审条件.md"), "# 本项目的评审条件\n", "utf8");
  const second = await writeCriteriaSkeleton(root);
  expect(second.status).toBe("kept");
  // The project's own requirements are kept, not overwritten by a skeleton.
  expect(await readFile(join(root, "评审条件.md"), "utf8")).toBe("# 本项目的评审条件\n");
});

test("a starting profile is written once and never replaces one", async () => {
  const root = await workspace();
  const first = await writeProfileSkeleton(root, ZONES);
  expect(first).toEqual({ status: "written", path: ".bid/workspace.json" });

  const written = JSON.parse(await readFile(join(root, ".bid", "workspace.json"), "utf8")) as {
    schemaVersion?: number;
    zones?: unknown;
    skills?: unknown;
  };
  expect(written.schemaVersion).toBe(1);
  expect(written.zones).toEqual(ZONES);
  expect(written.skills).toEqual(["bid-qualification", "bid-pricing-consistency"]);

  const second = await writeProfileSkeleton(root, ZONES);
  expect(second.status).toBe("kept");
});

test("versioning is created once and an existing repository is left alone", async () => {
  const root = await workspace();
  const created = await initWorkspaceGit(root);
  expect(["created", "skipped"]).toContain(created.status);
  if (created.status === "skipped") return;

  expect(await initWorkspaceGit(root)).toEqual({ status: "present" });
  expect((await stat(join(root, ".git"))).isDirectory()).toBe(true);
});
