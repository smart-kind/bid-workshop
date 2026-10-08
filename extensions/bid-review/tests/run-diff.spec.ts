import { expect, test } from "@playwright/test";
import { buildLedger, disposeFinding, runHeader, type FindingInput, type Ledger } from "../ledger";
import { diffLedgers } from "../run-diff";

/** T-18: the four classes, matched by fingerprint rather than by id. */

function ledgerOf(
  runId: string,
  entries: readonly (Partial<FindingInput> & { locationKey?: number })[],
): Ledger {
  const header = runHeader({
    runId,
    startedAt: "2026-10-08T00:00:00.000Z",
    documentPath: "/w/书.docx",
    documentFingerprint: "abc",
  });
  return buildLedger(
    header,
    entries.map((entry, index) => ({
      id: `${runId}-${index + 1}`,
      severity: "warning",
      check: "报价一致",
      verdict: "not-satisfied",
      problem: "有问题",
      location: { blockIndex: entry.locationKey ?? 0, quote: "合计" },
      ...entry,
    })),
  );
}

test("classifies added, persisted and gone", () => {
  const before = ledgerOf("run-1", [{ locationKey: 1 }, { locationKey: 2 }]);
  const after = ledgerOf("run-2", [{ locationKey: 2 }, { locationKey: 3 }]);

  const diff = diffLedgers(before, after);

  expect(diff.counts).toEqual({
    added: 1,
    persisted: 1,
    gone: 1,
    "still-present-after-disposition": 0,
  });
  expect(diff.added[0]?.finding?.location?.blockIndex).toBe(3);
  expect(diff.persisted[0]?.finding?.location?.blockIndex).toBe(2);
  expect(diff.gone[0]?.previous?.location?.blockIndex).toBe(1);
  // A gone entry has no finding in the newer run, and vice versa.
  expect(diff.gone[0]?.finding).toBeUndefined();
  expect(diff.added[0]?.previous).toBeUndefined();
});

test("an id change across runs is not a change of finding", () => {
  const before = ledgerOf("run-1", [{ locationKey: 5 }]);
  // Same criterion, same place, same quote — different id and different wording.
  const after = ledgerOf("run-2", [{ locationKey: 5, problem: "换了个说法", check: "报价一致" }]);

  const diff = diffLedgers(before, after);

  expect(diff.counts).toEqual({
    added: 0,
    persisted: 1,
    gone: 0,
    "still-present-after-disposition": 0,
  });
  expect(diff.persisted[0]?.previous?.id).toBe("run-1-1");
  expect(diff.persisted[0]?.finding?.id).toBe("run-2-1");
});

test("a finding that survives a disposition is called out, not silently persisted", () => {
  const before = ledgerOf("run-1", [{ locationKey: 1 }, { locationKey: 2 }]);
  const accepted = disposeFinding(before, { findingId: "run-1-1", disposition: "accepted" });
  expect(accepted.status).toBe("recorded");
  if (accepted.status !== "recorded") return;
  const rejected = disposeFinding(accepted.ledger, {
    findingId: "run-1-2",
    disposition: "rejected",
    note: "不适用",
  });
  expect(rejected.status).toBe("recorded");
  if (rejected.status !== "recorded") return;

  const after = ledgerOf("run-2", [{ locationKey: 1 }, { locationKey: 2 }]);
  const diff = diffLedgers(rejected.ledger, after);

  expect(diff.counts).toEqual({
    added: 0,
    persisted: 0,
    gone: 0,
    "still-present-after-disposition": 2,
  });
  expect(diff.stillPresentAfterDisposition.map((entry) => entry.previous?.disposition)).toEqual([
    "accepted",
    "rejected",
  ]);
  // The newer run's entries keep their own disposition: the diff changed nothing.
  expect(after.findings.map((finding) => finding.disposition)).toEqual(["pending", "pending"]);
});

test("an empty comparison says nothing happened", () => {
  const ledger = ledgerOf("run-1", [{ locationKey: 1 }]);
  expect(diffLedgers(ledger, ledger).counts).toEqual({
    added: 0,
    persisted: 1,
    gone: 0,
    "still-present-after-disposition": 0,
  });
  expect(diffLedgers(ledgerOf("run-1", []), ledgerOf("run-2", [])).counts).toEqual({
    added: 0,
    persisted: 0,
    gone: 0,
    "still-present-after-disposition": 0,
  });
});
