import { expect, test } from "@playwright/test";
import { EMPTY_WORKSPACE_ZONES, type WorkspaceZones } from "../../contracts/business-workspace";
import { createZoneResolver, normalizeRelativePath } from "../../contracts/workspace-zones";

function zones(partial: Partial<WorkspaceZones>): WorkspaceZones {
  return { ...EMPTY_WORKSPACE_ZONES, ...partial };
}

const declared = zones({
  reference: ["公司资料"],
  material: ["招标文件"],
  output: ["产出"],
  feedback: ["意见"],
});

test("refuses writes into read-only zones and allows the writable ones", () => {
  const resolver = createZoneResolver(declared);

  expect(resolver.isZoned).toBe(true);
  expect(resolver.zoneOf("公司资料/营业执照.pdf")).toBe("reference");
  expect(resolver.zoneOf("招标文件/招标书.docx")).toBe("material");
  expect(resolver.zoneOf("产出/投标文件-批注.docx")).toBe("output");
  expect(resolver.zoneOf("意见/评审条件.md")).toBe("feedback");

  expect(resolver.isReadOnlyPath("公司资料/营业执照.pdf")).toBe(true);
  expect(resolver.isReadOnlyPath("招标文件/招标书.docx")).toBe(true);
  expect(resolver.isReadOnlyPath("产出/投标文件-批注.docx")).toBe(false);

  expect(() => resolver.assertWritable("公司资料/营业执照.pdf")).toThrow(
    /read-only reference zone/,
  );
  expect(() => resolver.assertWritable("招标文件/招标书.docx")).toThrow(/read-only material zone/);
  expect(() => resolver.assertWritable("产出/投标文件-批注.docx")).not.toThrow();
  expect(() => resolver.assertWritable("意见/评审条件.md")).not.toThrow();
});

test("treats an undeclared path inside a zoned workspace as writable", () => {
  const resolver = createZoneResolver(declared);

  expect(resolver.zoneOf("随手记.md")).toBeUndefined();
  expect(resolver.isReadOnlyPath("随手记.md")).toBe(false);
  expect(() => resolver.assertWritable("随手记.md")).not.toThrow();
});

test("a flat workspace declares nothing and stays writable", () => {
  const resolver = createZoneResolver(EMPTY_WORKSPACE_ZONES);

  expect(resolver.isZoned).toBe(false);
  expect(resolver.entries).toEqual([]);
  expect(resolver.zoneOf("产出/任何文件.docx")).toBeUndefined();
  expect(resolver.isReadOnlyPath("产出/任何文件.docx")).toBe(false);
  expect(() => resolver.assertWritable("任何/位置/文件.docx")).not.toThrow();
});

test("rejects paths that escape the workspace", () => {
  const resolver = createZoneResolver(declared);
  const flat = createZoneResolver(EMPTY_WORKSPACE_ZONES);

  for (const escaping of [
    "../外部文件.docx",
    "产出/../../外部文件.docx",
    "/etc/passwd",
    "C:\\Windows\\system.ini",
    "..\\外部文件.docx",
  ]) {
    expect(() => resolver.assertWritable(escaping)).toThrow(/outside the workspace/);
    expect(() => flat.assertWritable(escaping)).toThrow(/outside the workspace/);
    expect(normalizeRelativePath(escaping)).toBeNull();
  }

  expect(normalizeRelativePath("产出/../招标文件/招标书.docx")).toBe("招标文件/招标书.docx");
  expect(resolver.zoneOf("产出/../公司资料/资料.pdf")).toBe("reference");
});

test("normalizes separators, dot segments and case", () => {
  const resolver = createZoneResolver(declared);

  expect(normalizeRelativePath("./产出//文件.docx")).toBe("产出/文件.docx");
  expect(normalizeRelativePath(".\\产出\\文件.docx")).toBe("产出/文件.docx");
  expect(resolver.zoneOf("产出/文件.docx")).toBe("output");
  expect(resolver.zoneOf("./产出/文件.docx")).toBe("output");
  expect(resolver.zoneOf("公司资料")).toBe("reference");

  const latin = createZoneResolver(zones({ material: ["Tender"] }));
  expect(latin.zoneOf("tender/notice.docx")).toBe("material");
  expect(latin.isReadOnlyPath("TENDER/notice.docx")).toBe(true);
});

test("maps several directories to one kind", () => {
  const resolver = createZoneResolver(
    zones({ material: ["招标文件", "澄清文件"], output: ["产出", "输出"] }),
  );

  expect(resolver.zoneOf("招标文件/a.docx")).toBe("material");
  expect(resolver.zoneOf("澄清文件/b.docx")).toBe("material");
  expect(resolver.zoneOf("输出/c.docx")).toBe("output");
  expect(resolver.isReadOnlyPath("澄清文件/b.docx")).toBe(true);
  expect(resolver.entries).toHaveLength(4);
});

test("the most specific declaration wins for nested paths", () => {
  const resolver = createZoneResolver(zones({ reference: ["资料"], output: ["资料/公开"] }));

  expect(resolver.zoneOf("资料/内部/a.pdf")).toBe("reference");
  expect(resolver.zoneOf("资料/公开/b.docx")).toBe("output");
  expect(() => resolver.assertWritable("资料/公开/b.docx")).not.toThrow();
  expect(() => resolver.assertWritable("资料/内部/a.pdf")).toThrow(/read-only/);
});

test("an ambiguous declaration of the same depth resolves to read-only", () => {
  const resolver = createZoneResolver(zones({ reference: ["资料"], output: ["资料"] }));

  expect(resolver.zoneOf("资料/a.docx")).toBe("reference");
  expect(resolver.isReadOnlyPath("资料/a.docx")).toBe(true);
  expect(() => resolver.assertWritable("资料/a.docx")).toThrow(/read-only/);
});

test("rejects a declared directory that is not a plain workspace-relative path", () => {
  for (const bad of ["../外部", "/绝对路径", "C:\\资料", ""]) {
    expect(() => createZoneResolver(zones({ reference: [bad] }))).toThrow(
      /Invalid workspace zones/,
    );
  }
});
