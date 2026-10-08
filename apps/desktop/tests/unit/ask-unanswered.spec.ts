import { expect, test } from "@playwright/test";
import {
  askUnansweredMessage,
  askUnansweredNotice,
  type AskUnansweredReason,
} from "../../contracts/ask";

const REASONS: readonly AskUnansweredReason[] = [
  "timeout",
  "session-changed",
  "window-closed",
  "runtime-replaced",
];

test("every unanswered reason says what happened and promises no choice", () => {
  const messages = REASONS.map((reason) => askUnansweredMessage(reason));

  for (const message of messages) {
    expect(message.trim().length).toBeGreaterThan(0);
  }
  expect(new Set(messages).size).toBe(REASONS.length);
  for (const message of messages) {
    expect(message).not.toMatch(/default|automatically|assumed/i);
  }
});

test("the record for an unanswered question names the request and warns", () => {
  const notice = askUnansweredNotice("timeout", "req-1", "2026-10-08T00:00:00.000Z");

  expect(notice).toEqual({
    id: "req-1:unanswered",
    level: "warning",
    message: askUnansweredMessage("timeout"),
    createdAt: "2026-10-08T00:00:00.000Z",
  });
});

test("one request settles to one record, whatever the reason turns out to be", () => {
  const first = askUnansweredNotice("session-changed", "req-2", "2026-10-08T00:00:00.000Z");
  const second = askUnansweredNotice("window-closed", "req-2", "2026-10-08T00:00:01.000Z");

  expect(first.id).toBe(second.id);
  expect(first.message).not.toBe(second.message);
});
