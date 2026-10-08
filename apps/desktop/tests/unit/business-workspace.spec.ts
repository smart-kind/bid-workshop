import { expect, test } from "@playwright/test";
import {
  DEFAULT_WORKSPACE_DELIVERY,
  EMPTY_WORKSPACE_ZONES,
  WORKSPACE_PROFILE_SCHEMA_VERSION,
  decodeWorkspaceProfile,
} from "../../contracts/business-workspace";

test("decodes a fully declared profile", () => {
  const decoded = decodeWorkspaceProfile({
    schemaVersion: 1,
    business: "bid-tender",
    name: "某软件科技-投诉系统项目投标",
    goal: "按评审条件审查产出目录的投标文件，逐条出批注",
    zones: {
      reference: ["公司资料"],
      material: ["招标文件"],
      output: ["产出"],
      feedback: ["意见"],
    },
    skills: ["bid-qualification", "bid-pricing-consistency"],
    capabilities: { mcp: ["company-kb"] },
    delivery: {
      commentTarget: "inPlace",
      outputSuffix: "-意见",
      criteriaFile: "评审条件.md",
    },
  });

  expect(decoded.schemaVersion).toBe(WORKSPACE_PROFILE_SCHEMA_VERSION);
  expect(decoded.business).toBe("bid-tender");
  expect(decoded.name).toBe("某软件科技-投诉系统项目投标");
  expect(decoded.zones.material).toEqual(["招标文件"]);
  expect(decoded.skills).toEqual(["bid-qualification", "bid-pricing-consistency"]);
  expect(decoded.capabilities.mcp).toEqual(["company-kb"]);
  expect(decoded.delivery).toEqual({
    commentTarget: "inPlace",
    outputSuffix: "-意见",
    criteriaFile: "评审条件.md",
  });
});

test("fills every default for a flat profile", () => {
  const decoded = decodeWorkspaceProfile({ schemaVersion: 1, business: "bid-tender" });

  expect(decoded.name).toBeUndefined();
  expect(decoded.goal).toBeUndefined();
  expect(decoded.zones).toEqual(EMPTY_WORKSPACE_ZONES);
  expect(decoded.skills).toEqual([]);
  expect(decoded.capabilities).toEqual({ mcp: [] });
  expect(decoded.delivery).toEqual(DEFAULT_WORKSPACE_DELIVERY);
  expect(DEFAULT_WORKSPACE_DELIVERY.commentTarget).toBe("copy");
});

test("normalizes partial delivery and blank optional fields", () => {
  const decoded = decodeWorkspaceProfile({
    schemaVersion: 1,
    business: "bid-tender",
    name: "   ",
    zones: { output: ["产出"] },
    delivery: { outputSuffix: " -定稿 " },
  });

  expect(decoded.name).toBeUndefined();
  expect(decoded.zones).toEqual({
    reference: [],
    material: [],
    output: ["产出"],
    feedback: [],
  });
  expect(decoded.delivery).toEqual({
    commentTarget: "copy",
    outputSuffix: "-定稿",
    criteriaFile: "评审条件.md",
  });
});

for (const version of [2, 99, 0, -1, "1", null, undefined]) {
  test(`rejects unsupported schema version ${JSON.stringify(version)}`, () => {
    expect(() =>
      decodeWorkspaceProfile({ schemaVersion: version, business: "bid-tender" }),
    ).toThrow(/Invalid workspace profile: unsupported schema version/);
  });
}

for (const [label, value] of [
  ["missing business", { schemaVersion: 1 }],
  ["blank business", { schemaVersion: 1, business: "   " }],
  ["non-string business", { schemaVersion: 1, business: 42 }],
  ["zones not an object", { schemaVersion: 1, business: "bid-tender", zones: ["公司资料"] }],
  [
    "zone entry not a list",
    { schemaVersion: 1, business: "bid-tender", zones: { output: "产出" } },
  ],
  ["zone entry not a string", { schemaVersion: 1, business: "bid-tender", zones: { output: [7] } }],
  ["skills not a list", { schemaVersion: 1, business: "bid-tender", skills: "bid-qualification" }],
  ["skill entry not a string", { schemaVersion: 1, business: "bid-tender", skills: [null] }],
  ["mcp not a list", { schemaVersion: 1, business: "bid-tender", capabilities: { mcp: {} } }],
  ["delivery not an object", { schemaVersion: 1, business: "bid-tender", delivery: "copy" }],
  [
    "unknown comment target",
    { schemaVersion: 1, business: "bid-tender", delivery: { commentTarget: "overwrite" } },
  ],
] as const) {
  test(`rejects ${label}`, () => {
    expect(() => decodeWorkspaceProfile(value)).toThrow(/Invalid workspace profile/);
  });
}

for (const [label, value] of [
  ["top level", { schemaVersion: 1, business: "bid-tender", workspaceId: "abc" }],
  ["zones", { schemaVersion: 1, business: "bid-tender", zones: { library: ["公司资料"] } }],
  [
    "capabilities",
    { schemaVersion: 1, business: "bid-tender", capabilities: { mcp: [], token: "secret" } },
  ],
  [
    "delivery",
    { schemaVersion: 1, business: "bid-tender", delivery: { commentTarget: "copy", extra: 1 } },
  ],
] as const) {
  test(`rejects unknown fields at ${label}`, () => {
    expect(() => decodeWorkspaceProfile(value)).toThrow(/unknown field/);
  });
}
