import { expect, test } from "@playwright/test";
import {
  buildLedger,
  findingFingerprint,
  findingViolations,
  runHeader,
  type FindingInput,
} from "../ledger";

/** T-16: the ledger refuses a submission that would not be a usable record. */

const HEADER = runHeader({
  runId: "run-1",
  startedAt: "2026-10-08T00:00:00.000Z",
  documentPath: "/w/招标文件/招标书.docx",
  documentFingerprint: "abc123",
  skills: [{ id: "bid-qualification", fingerprint: "s1" }],
  criteria: { file: "评审条件.md", fingerprint: "c1" },
  model: "test-model",
});

function finding(overrides: Partial<FindingInput> = {}): FindingInput {
  return {
    id: "F-1",
    severity: "warning",
    check: "资质文件齐全",
    verdict: "not-satisfied",
    problem: "缺少营业执照",
    ...overrides,
  };
}

test("accepts a well-formed submission and fills the ledger in", () => {
  const ledger = buildLedger(HEADER, [finding()]);

  expect(ledger.header.documentFingerprint).toBe("abc123");
  expect(ledger.header.skills).toEqual([{ id: "bid-qualification", fingerprint: "s1" }]);
  expect(ledger.findings).toHaveLength(1);
  expect(ledger.findings[0]).toMatchObject({
    id: "F-1",
    severity: "warning",
    verdict: "not-satisfied",
    problem: "缺少营业执照",
    disposition: "pending",
  });
  expect(ledger.findings[0]?.fingerprint).toMatch(/^[0-9a-f]{16}$/);
});

test("refuses the submissions that would not be a usable record", () => {
  expect(findingViolations([])).toEqual([]);
  expect(findingViolations([finding()])).toEqual([]);

  expect(findingViolations([finding(), finding()])).toEqual(["findings[1].id 重复：F-1"]);
  expect(findingViolations([finding({ id: " " })])).toEqual(["findings[0].id 不能为空"]);
  expect(findingViolations([finding({ check: "  " })])).toEqual(["findings[0].check 不能为空"]);
  expect(findingViolations([finding({ severity: "blocker" })])).toEqual([
    "findings[0].severity 非法：blocker",
  ]);
  expect(findingViolations([finding({ verdict: "maybe" })])).toEqual([
    "findings[0].verdict 非法：maybe",
  ]);
  // Anything short of "satisfied" has to say what is wrong.
  expect(findingViolations([finding({ verdict: "unclear", problem: "" })])).toEqual([
    "findings[0].problem 必填（verdict 为 unclear 时必须写明问题）",
  ]);
  expect(findingViolations([finding({ verdict: "satisfied", problem: undefined })])).toEqual([]);
});

test("reports every problem at once instead of one per attempt", () => {
  const violations = findingViolations([
    finding({ id: "", severity: "nope", verdict: "nope", problem: "" }),
    finding({ id: "F-2", check: "" }),
  ]);

  expect(violations.length).toBeGreaterThanOrEqual(5);
  expect(violations.some((entry) => entry.includes("id 不能为空"))).toBe(true);
  expect(violations.some((entry) => entry.includes("severity 非法"))).toBe(true);
  expect(violations.some((entry) => entry.includes("verdict 非法"))).toBe(true);
  expect(violations.some((entry) => entry.includes("problem 必填"))).toBe(true);
  expect(violations.some((entry) => entry.includes("check 不能为空"))).toBe(true);
});

test("buildLedger refuses rather than storing a broken ledger", () => {
  expect(() => buildLedger(HEADER, [finding({ id: "F-1" }), finding({ id: "F-1" })])).toThrow(
    /台账校验未通过/,
  );
});

test("the fingerprint follows the criterion, the place and the quote — not the wording", () => {
  const base = findingFingerprint({
    check: "报价一致",
    location: { blockIndex: 3, quote: "合计 120 万" },
  });

  expect(
    findingFingerprint({ check: "报价一致", location: { blockIndex: 3, quote: "合计 120 万" } }),
  ).toBe(base);
  // Same place, rewritten problem: the same finding.
  const rewritten = buildLedger(HEADER, [
    finding({
      check: "报价一致",
      location: { blockIndex: 3, quote: "合计 120 万" },
      problem: "改了个说法",
    }),
  ]);
  expect(rewritten.findings[0]?.fingerprint).toBe(base);
  // Moved, re-quoted or judged against another criterion: a different finding.
  expect(
    findingFingerprint({ check: "报价一致", location: { blockIndex: 4, quote: "合计 120 万" } }),
  ).not.toBe(base);
  expect(
    findingFingerprint({ check: "报价一致", location: { blockIndex: 3, quote: "合计 130 万" } }),
  ).not.toBe(base);
  expect(
    findingFingerprint({ check: "工期合理", location: { blockIndex: 3, quote: "合计 120 万" } }),
  ).not.toBe(base);
  // A table cell is identified by its row and column, not just the table.
  expect(
    findingFingerprint({
      check: "报价一致",
      location: { blockIndex: 3, quote: "合计 120 万", cell: { row: 3, column: 2 } },
    }),
  ).not.toBe(base);
});
