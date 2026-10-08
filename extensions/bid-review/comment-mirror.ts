import type { BidComment } from "./document";
import { dispositionLabel, type Finding, type Ledger } from "./ledger";

/**
 * Mirroring a disposition onto the comment that raised it.
 *
 * The ledger is the authority: a comment is only ever changed to follow it. The
 * match is made on the text the comment carries, because a comment written in an
 * earlier session has no id that survives in the ledger — the words are the
 * link. A finding whose comment cannot be found is reported, not guessed at.
 */

export interface CommentMirrorUpdate {
  readonly commentId: string;
  readonly findingId: string;
  /** Mark the comment resolved, or clear it when the disposition goes back to pending. */
  readonly done: boolean;
  /** The reply appended under the comment; absent when nothing needs saying. */
  readonly reply?: string;
}

export interface CommentMirrorPlan {
  readonly updates: readonly CommentMirrorUpdate[];
  /** Findings whose comment is not in this document. */
  readonly unmatched: readonly string[];
}

export function mirrorReply(finding: Finding): string | undefined {
  const label = dispositionLabel(finding.disposition);
  const note = finding.dispositionNote?.trim();
  if (finding.disposition === "pending") return undefined;
  return note ? `${label}：${note}` : label;
}

/** The comment that raised this finding: the one carrying its problem's words. */
function findComment(comments: readonly BidComment[], finding: Finding): BidComment | undefined {
  const needle = finding.problem?.trim() || finding.check.trim();
  if (!needle) return undefined;
  return comments.find((comment) => comment.text.includes(needle));
}

export function planDispositionMirror(
  comments: readonly BidComment[],
  ledger: Ledger,
): CommentMirrorPlan {
  const updates: CommentMirrorUpdate[] = [];
  const unmatched: string[] = [];
  for (const finding of ledger.findings) {
    if (finding.disposition === "pending" && !finding.dispositionNote) continue;
    const comment = findComment(comments, finding);
    if (!comment) {
      unmatched.push(finding.id);
      continue;
    }
    const reply = mirrorReply(finding);
    updates.push({
      commentId: comment.id,
      findingId: finding.id,
      done: finding.disposition === "accepted",
      ...(reply ? { reply } : {}),
    });
  }
  return { updates, unmatched };
}

export interface CommentSyncRow {
  readonly findingId: string;
  readonly state: "matched" | "missing";
  /** What the document says about it, when it is there. */
  readonly documentDone?: boolean;
  /** True when Word disagrees with the ledger. The ledger still decides. */
  readonly disagrees: boolean;
}

/**
 * The explicit "read it back from the document" report. It never changes a
 * disposition: the ledger is the authority, so a difference is something the
 * user is told about, not something the app applies on its own.
 */
export function describeCommentSync(
  comments: readonly BidComment[],
  ledger: Ledger,
): readonly CommentSyncRow[] {
  return ledger.findings.map((finding) => {
    const comment = findComment(comments, finding);
    if (!comment) return { findingId: finding.id, state: "missing", disagrees: false };
    const documentDone = comment.done === true;
    const ledgerDone = finding.disposition === "accepted";
    return {
      findingId: finding.id,
      state: "matched",
      documentDone,
      disagrees: documentDone !== ledgerDone,
    };
  });
}
