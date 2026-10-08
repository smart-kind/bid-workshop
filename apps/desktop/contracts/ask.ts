/**
 * What happens when a question the app put to the user is never answered.
 *
 * A timeout, a thread switch, a closed window and a restarted runtime all settle
 * a prompt the same way for the caller — it was cancelled — which is why the
 * user gets an explicit record instead of the prompt quietly disappearing. The
 * record names the reason; it never turns into a default choice.
 */

import type { SessionExtensionNoticeRecord } from "./desktop-state";

export type AskUnansweredReason =
  "timeout" | "session-changed" | "window-closed" | "runtime-replaced";

const MESSAGES: Readonly<Record<AskUnansweredReason, string>> = {
  timeout: "A question went unanswered and timed out. Nothing was chosen for you.",
  "session-changed": "A question was left unanswered because the thread changed.",
  "window-closed": "A question was left unanswered because the window closed.",
  "runtime-replaced": "A question was left unanswered because the runtime restarted.",
};

export function askUnansweredMessage(reason: AskUnansweredReason): string {
  return MESSAGES[reason];
}

/** The notice a settled-without-answer prompt leaves in the session. */
export function askUnansweredNotice(
  reason: AskUnansweredReason,
  requestId: string,
  createdAt: string,
): SessionExtensionNoticeRecord {
  return {
    id: `${requestId}:unanswered`,
    level: "warning",
    message: askUnansweredMessage(reason),
    createdAt,
  };
}
