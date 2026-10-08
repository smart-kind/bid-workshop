import { expect, test } from "@playwright/test";
import {
  buildLedger,
  disposeFinding,
  dispositionProgress,
  runHeader,
  type FindingInput,
  type Ledger,
} from "../ledger";

/** T-17: dispositions migrate lawfully, and a rejection carries its reason. */

function ledgerOf(...overrides: Partial<FindingInput>[]): Ledger {
  const header = runHeader({
    runId: "run-1",
    startedAt: "2026-10-08T00:00:00.000Z",
    documentPath: "/w/书.docx",
    documentFingerprint: "abc",
  });
  return buildLedger(
    header,
    overrides.map((override, index) => ({
      id: `F-${index + 1}`,
      severity: "warning",
      check: `判据 ${index + 1}`,
      verdict: "not-satisfied",
      problem: "有问题",
      ...override,
    })),
  );
}

test("records a disposition with who, when and why", () => {
  const ledger = ledgerOf({}, {});
  const result = disposeFinding(ledger, {
    findingId: "F-1",
    disposition: "accepted",
    note: "确认属实",
    by: "张工",
    at: "2026-10-08T01:00:00.000Z",
  });

  expect(result.status).toBe("recorded");
  if (result.status !== "recorded") return;
  const [first, second] = result.ledger.findings;
  expect(first).toMatchObject({
    disposition: "accepted",
    disposedBy: "张工",
    disposedAt: "2026-10-08T01:00:00.000Z",
    dispositionNote: "确认属实",
  });
  // Only the disposed entry moves; the other keeps its own state.
  expect(second?.disposition).toBe("pending");
  expect(second?.disposedAt).toBeUndefined();
  // The original ledger is not mutated.
  expect(ledger.findings[0]?.disposition).toBe("pending");
});

test("keeps the reason of a rejection: it is what improves the criteria", () => {
  const ledger = ledgerOf({});
  const result = disposeFinding(ledger, {
    findingId: "F-1",
    disposition: "rejected",
    note: "该情形招标文件未作要求",
  });

  expect(result.status).toBe("recorded");
  if (result.status !== "recorded") return;
  expect(result.ledger.findings[0]?.dispositionNote).toBe("该情形招标文件未作要求");
});

test("refuses the moves that would make the record misleading", () => {
  const ledger = ledgerOf({}, {});

  // Unknown entry.
  expect(disposeFinding(ledger, { findingId: "F-9", disposition: "accepted" })).toEqual({
    status: "refused",
    reason: "台账里没有编号为 F-9 的条目",
  });
  // Not a disposition.
  expect(disposeFinding(ledger, { findingId: "F-1", disposition: "maybe" as never })).toMatchObject(
    { status: "refused" },
  );
  // A rejection with no reason.
  expect(disposeFinding(ledger, { findingId: "F-1", disposition: "rejected", note: "  " })).toEqual(
    {
      status: "refused",
      reason: "驳回必须写明理由：它是判据改进的输入",
    },
  );

  const accepted = disposeFinding(ledger, { findingId: "F-1", disposition: "accepted" });
  expect(accepted.status).toBe("recorded");
  if (accepted.status !== "recorded") return;
  // Re-recording the same disposition would look like a fresh decision.
  expect(disposeFinding(accepted.ledger, { findingId: "F-1", disposition: "accepted" })).toEqual({
    status: "refused",
    reason: "F-1 已经是已采纳，无需重复处置",
  });
  // Changing one's mind is a real move, and so is sending it back to pending.
  expect(
    disposeFinding(accepted.ledger, { findingId: "F-1", disposition: "rejected", note: "再核" }),
  ).toMatchObject({ status: "recorded" });
  expect(
    disposeFinding(accepted.ledger, { findingId: "F-1", disposition: "pending" }),
  ).toMatchObject({ status: "recorded" });
});

test("progress is recomputed from the ledger as entries move", () => {
  const ledger = ledgerOf({}, {}, {});
  expect(dispositionProgress(ledger)).toEqual({
    total: 3,
    pending: 3,
    accepted: 0,
    rejected: 0,
  });

  const first = disposeFinding(ledger, { findingId: "F-1", disposition: "accepted" });
  expect(first.status).toBe("recorded");
  if (first.status !== "recorded") return;
  expect(first.progress).toEqual({ total: 3, pending: 2, accepted: 1, rejected: 0 });

  const second = disposeFinding(first.ledger, {
    findingId: "F-2",
    disposition: "rejected",
    note: "不适用",
  });
  expect(second.status).toBe("recorded");
  if (second.status !== "recorded") return;
  expect(second.progress).toEqual({ total: 3, pending: 1, accepted: 1, rejected: 1 });
});
