import { expect, test } from "@playwright/test";
import { describeCommentSync, planDispositionMirror } from "../comment-mirror";
import { buildLedger, disposeFinding, runHeader, type FindingInput, type Ledger } from "../ledger";
import type { BidComment } from "../document";

/** T-19: the ledger is the authority; the comment follows it. */

function ledgerOf(entries: Partial<FindingInput>[]): Ledger {
  return buildLedger(
    runHeader({
      runId: "run-1",
      startedAt: "2026-10-08T00:00:00.000Z",
      documentPath: "/w/书.docx",
      documentFingerprint: "abc",
    }),
    entries.map((entry, index) => ({
      id: `F-${index + 1}`,
      severity: "warning",
      check: "报价一致",
      verdict: "not-satisfied",
      problem: `问题 ${index + 1}`,
      ...entry,
    })),
  );
}

const comments: BidComment[] = [
  { id: "1", author: "审查", text: "【警告】问题 1\n报价与明细不一致" },
  { id: "2", author: "审查", text: "【警告】问题 2\n少了盖章页" },
];

test("marks the comment done and appends the reason when a finding is accepted", () => {
  const ledger = ledgerOf([{}, {}]);
  const accepted = disposeFinding(ledger, {
    findingId: "F-1",
    disposition: "accepted",
    note: "确认属实",
  });
  expect(accepted.status).toBe("recorded");
  if (accepted.status !== "recorded") return;

  const plan = planDispositionMirror(comments, accepted.ledger);

  expect(plan.unmatched).toEqual([]);
  expect(plan.updates).toHaveLength(1);
  expect(plan.updates[0]).toEqual({
    commentId: "1",
    findingId: "F-1",
    done: true,
    reply: "已采纳：确认属实",
  });
});

test("a rejection is mirrored as a reply with its reason, and not marked done", () => {
  const ledger = ledgerOf([{}]);
  const rejected = disposeFinding(ledger, {
    findingId: "F-1",
    disposition: "rejected",
    note: "招标文件未作要求",
  });
  expect(rejected.status).toBe("recorded");
  if (rejected.status !== "recorded") return;

  const plan = planDispositionMirror(comments, rejected.ledger);

  expect(plan.updates[0]).toMatchObject({
    commentId: "1",
    done: false,
    reply: "已驳回：招标文件未作要求",
  });
});

test("a pending finding is left alone, and an unmatched one is reported", () => {
  const ledger = ledgerOf([{}, { problem: "文档里没有这条" }]);
  const accepted = disposeFinding(ledger, { findingId: "F-1", disposition: "accepted" });
  expect(accepted.status).toBe("recorded");
  if (accepted.status !== "recorded") return;
  const second = disposeFinding(accepted.ledger, {
    findingId: "F-2",
    disposition: "accepted",
  });
  expect(second.status).toBe("recorded");
  if (second.status !== "recorded") return;

  const plan = planDispositionMirror(comments, second.ledger);

  // F-1 was accepted; F-2 matches nothing in the document and says so.
  expect(plan.updates.map((update) => update.findingId)).toEqual(["F-1"]);
  expect(plan.unmatched).toEqual(["F-2"]);
  expect(planDispositionMirror(comments, ledgerOf([{}])).updates).toEqual([]);
});

test("reading back from the document reports a disagreement instead of applying it", () => {
  const ledger = ledgerOf([{}, {}]);
  const accepted = disposeFinding(ledger, { findingId: "F-1", disposition: "accepted" });
  expect(accepted.status).toBe("recorded");
  if (accepted.status !== "recorded") return;

  // Word says comment 1 is still open, and the second finding's comment is absent.
  const rows = describeCommentSync(
    [comments[0] ?? { id: "1", author: "审查", text: "问题 1" }],
    accepted.ledger,
  );

  expect(rows).toEqual([
    { findingId: "F-1", state: "matched", documentDone: false, disagrees: true },
    { findingId: "F-2", state: "missing", disagrees: false },
  ]);
  // The ledger itself is untouched by reading the document.
  expect(accepted.ledger.findings[0]?.disposition).toBe("accepted");
});
