import { createHash } from "node:crypto";

/**
 * The ledger: one review run's header and its findings. It is the record the
 * panel shows, the next run compares against, and a disposition writes back
 * into — so a finding is never inferred from prose, it is an entry.
 *
 * The shape follows docs/business-workspace-design.md §7.4.
 */

export const FINDING_SEVERITIES = ["critical", "warning", "info"] as const;
export const FINDING_VERDICTS = [
  "satisfied",
  "not-satisfied",
  "unclear",
  "not-applicable",
] as const;
export const FINDING_DISPOSITIONS = ["pending", "accepted", "rejected"] as const;

export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];
export type FindingVerdict = (typeof FINDING_VERDICTS)[number];
export type FindingDisposition = (typeof FINDING_DISPOSITIONS)[number];

export interface FindingLocation {
  section?: string;
  blockIndex?: number;
  page?: number;
  quote?: string;
  cell?: { row: number; column: number; label?: string };
  /** True when the anchor had to degrade, e.g. a table cell. */
  degraded?: boolean;
}

export interface Finding {
  readonly id: string;
  readonly severity: FindingSeverity;
  /** The criterion this was judged against. */
  readonly check: string;
  readonly verdict: FindingVerdict;
  /** What the judgement rests on: the requirement's own words or citation. */
  readonly basis?: string;
  readonly location?: FindingLocation;
  /** Required unless the verdict says the criterion is met. */
  readonly problem?: string;
  readonly advice?: string;
  readonly disposition: FindingDisposition;
  /** Who dispositioned it, when, and why — kept even for a rejection. */
  readonly disposedBy?: string;
  readonly disposedAt?: string;
  readonly dispositionNote?: string;
  /** Stable digest of check + location + quote; see {@link findingFingerprint}. */
  readonly fingerprint: string;
}

export interface RunSkillRef {
  readonly id: string;
  /** Content digest of the skill as it was used, so a run can be reproduced. */
  readonly fingerprint?: string;
}

export interface ReviewRunHeader {
  readonly runId: string;
  readonly startedAt: string;
  readonly documentPath: string;
  /** sha256 of the reviewed bytes: what this run actually judged. */
  readonly documentFingerprint: string;
  readonly skills: readonly RunSkillRef[];
  readonly criteria?: { readonly file: string; readonly fingerprint?: string };
  readonly model?: string;
}

export interface Ledger {
  readonly header: ReviewRunHeader;
  readonly findings: readonly Finding[];
}

/** What a caller submits for one finding; the ledger fills the rest in. */
export interface FindingInput {
  readonly id: string;
  readonly severity: string;
  readonly check: string;
  readonly verdict: string;
  readonly basis?: string;
  readonly location?: FindingLocation;
  readonly problem?: string;
  readonly advice?: string;
}

/**
 * The identity of a finding across runs: the criterion, where it is, and the
 * quoted text. Wording of the problem and the advice is deliberately excluded —
 * rewording the same problem is the same finding, but moving it or quoting
 * different text is not.
 */
export function findingFingerprint(input: {
  readonly check: string;
  readonly location?: FindingLocation;
  readonly quote?: string;
}): string {
  const location = input.location ?? {};
  const parts = [
    input.check.trim(),
    String(location.blockIndex ?? ""),
    location.page === undefined ? "" : String(location.page),
    (location.section ?? "").trim(),
    (location.cell ? `${location.cell.row}:${location.cell.column}` : "").trim(),
    (input.quote ?? location.quote ?? "").trim(),
  ];
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16);
}

/**
 * Everything wrong with a submission, in one pass, so a caller can be told all
 * of it instead of one problem per attempt. An empty list means it is valid.
 */
export function findingViolations(findings: readonly FindingInput[]): string[] {
  const violations: string[] = [];
  const seen = new Set<string>();
  findings.forEach((finding, index) => {
    const at = `findings[${index}]`;
    const id = finding.id?.trim() ?? "";
    if (!id) {
      violations.push(`${at}.id 不能为空`);
    } else if (seen.has(id)) {
      violations.push(`${at}.id 重复：${id}`);
    } else {
      seen.add(id);
    }
    if (!finding.check?.trim()) violations.push(`${at}.check 不能为空`);
    if (!FINDING_SEVERITIES.includes(finding.severity as FindingSeverity)) {
      violations.push(`${at}.severity 非法：${String(finding.severity)}`);
    }
    if (!FINDING_VERDICTS.includes(finding.verdict as FindingVerdict)) {
      violations.push(`${at}.verdict 非法：${String(finding.verdict)}`);
    }
    // Only a met criterion may skip the problem: anything else has to say what is wrong.
    if (finding.verdict !== "satisfied" && !finding.problem?.trim()) {
      violations.push(`${at}.problem 必填（verdict 为 ${String(finding.verdict)} 时必须写明问题）`);
    }
  });
  return violations;
}

/** Build one entry from a submission, normalising the enumerations. */
export function makeFinding(input: FindingInput): Finding {
  const location = input.location;
  const finding: Finding = {
    id: input.id.trim(),
    severity: input.severity as FindingSeverity,
    check: input.check.trim(),
    verdict: input.verdict as FindingVerdict,
    disposition: "pending",
    fingerprint: findingFingerprint({
      check: input.check,
      ...(location ? { location } : {}),
      ...(input.location?.quote ? { quote: input.location.quote } : {}),
    }),
    ...(input.basis?.trim() ? { basis: input.basis.trim() } : {}),
    ...(location ? { location } : {}),
    ...(input.problem?.trim() ? { problem: input.problem.trim() } : {}),
    ...(input.advice?.trim() ? { advice: input.advice.trim() } : {}),
  };
  return finding;
}

/** Build a ledger, refusing a submission that would not be a usable record. */
export function buildLedger(header: ReviewRunHeader, findings: readonly FindingInput[]): Ledger {
  const violations = findingViolations(findings);
  if (violations.length > 0) {
    throw new Error(`台账校验未通过：${violations.join("；")}`);
  }
  return { header, findings: findings.map(makeFinding) };
}

/** A header with everything this run rested on, so it can be reproduced. */
export function runHeader(input: {
  runId: string;
  startedAt: string;
  documentPath: string;
  documentFingerprint: string;
  skills?: readonly RunSkillRef[];
  criteria?: { file: string; fingerprint?: string };
  model?: string;
}): ReviewRunHeader {
  return {
    ...input,
    skills: input.skills ?? [],
  };
}

/** How a run's findings stand. Recomputed from the ledger, never tracked apart. */
export interface DispositionProgress {
  readonly total: number;
  readonly pending: number;
  readonly accepted: number;
  readonly rejected: number;
}

export function dispositionProgress(ledger: Ledger): DispositionProgress {
  const progress = { total: ledger.findings.length, pending: 0, accepted: 0, rejected: 0 };
  for (const finding of ledger.findings) {
    progress[finding.disposition] += 1;
  }
  return progress;
}

export interface DispositionRequest {
  readonly findingId: string;
  readonly disposition: FindingDisposition;
  /** Required when rejecting: why it was rejected is what improves the criteria. */
  readonly note?: string;
  readonly by?: string;
  readonly at?: string;
}

export type DispositionResult =
  | { readonly status: "recorded"; readonly ledger: Ledger; readonly progress: DispositionProgress }
  | { readonly status: "refused"; readonly reason: string };

/**
 * Move one finding to a disposition, recording who did it, when and why.
 *
 * Refused, rather than silently recorded, when: the finding is not in the
 * ledger; the target is the disposition it already has (a no-op that would
 * still look like a fresh decision); or it is a rejection with no reason.
 */
export function disposeFinding(ledger: Ledger, request: DispositionRequest): DispositionResult {
  const index = ledger.findings.findIndex((finding) => finding.id === request.findingId);
  if (index < 0) {
    return { status: "refused", reason: `台账里没有编号为 ${request.findingId} 的条目` };
  }
  if (!FINDING_DISPOSITIONS.includes(request.disposition)) {
    return { status: "refused", reason: `处置非法：${String(request.disposition)}` };
  }
  const current = ledger.findings[index];
  if (!current) {
    return { status: "refused", reason: `台账里没有编号为 ${request.findingId} 的条目` };
  }
  if (current.disposition === request.disposition) {
    return {
      status: "refused",
      reason: `${request.findingId} 已经是${dispositionLabel(request.disposition)}，无需重复处置`,
    };
  }
  const note = request.note?.trim();
  if (request.disposition === "rejected" && !note) {
    return { status: "refused", reason: "驳回必须写明理由：它是判据改进的输入" };
  }

  const updated: Finding = {
    ...current,
    disposition: request.disposition,
    disposedBy: request.by?.trim() || current.disposedBy || "user",
    disposedAt: request.at ?? new Date().toISOString(),
    ...(note ? { dispositionNote: note } : {}),
  };
  const findings = [...ledger.findings];
  findings[index] = updated;
  const next: Ledger = { header: ledger.header, findings };
  return { status: "recorded", ledger: next, progress: dispositionProgress(next) };
}

const DISPOSITION_LABELS: Readonly<Record<FindingDisposition, string>> = {
  pending: "待定",
  accepted: "已采纳",
  rejected: "已驳回",
};

export function dispositionLabel(disposition: FindingDisposition): string {
  return DISPOSITION_LABELS[disposition];
}
