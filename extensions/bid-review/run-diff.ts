import type { Finding, Ledger } from "./ledger";

/**
 * What changed between two review runs.
 *
 * Findings are matched by fingerprint (criterion + place + quote), not by id:
 * a new run numbers its findings afresh, so an id says nothing across runs.
 * The diff is a report only — it never carries a disposition forward by itself,
 * because "still there after we rejected it" is a judgement for the reader.
 */

export const RUN_DIFF_KINDS = [
  "added",
  "persisted",
  "gone",
  "still-present-after-disposition",
] as const;

export type RunDiffKind = (typeof RUN_DIFF_KINDS)[number];

export interface RunDiffEntry {
  readonly kind: RunDiffKind;
  readonly fingerprint: string;
  /** The finding in the newer run; absent for `gone`. */
  readonly finding?: Finding;
  /** The finding in the older run; absent for `added`. */
  readonly previous?: Finding;
}

export interface RunDiff {
  readonly added: readonly RunDiffEntry[];
  readonly persisted: readonly RunDiffEntry[];
  readonly gone: readonly RunDiffEntry[];
  readonly stillPresentAfterDisposition: readonly RunDiffEntry[];
  readonly counts: Readonly<Record<RunDiffKind, number>>;
}

/** The first entry per fingerprint: a run that repeats one is still one finding. */
function byFingerprint(ledger: Ledger): Map<string, Finding> {
  const index = new Map<string, Finding>();
  for (const finding of ledger.findings) {
    if (!index.has(finding.fingerprint)) index.set(finding.fingerprint, finding);
  }
  return index;
}

export function diffLedgers(previous: Ledger, next: Ledger): RunDiff {
  const before = byFingerprint(previous);
  const after = byFingerprint(next);
  const added: RunDiffEntry[] = [];
  const persisted: RunDiffEntry[] = [];
  const stillPresent: RunDiffEntry[] = [];

  for (const finding of after.values()) {
    const earlier = before.get(finding.fingerprint);
    if (!earlier) {
      added.push({ kind: "added", fingerprint: finding.fingerprint, finding });
      continue;
    }
    const entry: RunDiffEntry = {
      kind: earlier.disposition === "pending" ? "persisted" : "still-present-after-disposition",
      fingerprint: finding.fingerprint,
      finding,
      previous: earlier,
    };
    if (entry.kind === "persisted") persisted.push(entry);
    else stillPresent.push(entry);
  }

  const gone: RunDiffEntry[] = [];
  for (const finding of before.values()) {
    if (after.has(finding.fingerprint)) continue;
    gone.push({ kind: "gone", fingerprint: finding.fingerprint, previous: finding });
  }

  return {
    added,
    persisted,
    gone,
    stillPresentAfterDisposition: stillPresent,
    counts: {
      added: added.length,
      persisted: persisted.length,
      gone: gone.length,
      "still-present-after-disposition": stillPresent.length,
    },
  };
}

/** One line per class, for a panel header or a tool result. */
export function describeRunDiff(diff: RunDiff): string {
  const { counts } = diff;
  return `新增 ${counts.added} / 仍存在 ${counts.persisted} / 未再出现 ${counts.gone} / 已处置后仍存在 ${counts["still-present-after-disposition"]}`;
}
