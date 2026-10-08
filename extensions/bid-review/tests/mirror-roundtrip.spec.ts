import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { planDispositionMirror } from "../comment-mirror";
import { buildLedger, disposeFinding, runHeader, type FindingInput } from "../ledger";
import { docxCommentWriter, docxDispositionMirror, docxParser } from "../parser-docx.mjs";
import { setBidCommentWriter, writeBidComments } from "../document";

/** T-19 end to end: a disposition is written back into the working copy. */

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const SAMPLE_FILE = "投标文件-某软件科技.docx";

setBidCommentWriter(docxCommentWriter);

function ledgerOf(entries: Partial<FindingInput>[]) {
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
      problem: `问题${index + 1}`,
      blockIndex: index,
      ...entry,
    })),
  );
}

test("a disposition marks its comment done and appends the reason", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bid-mirror-"));
  const source = join(directory, SAMPLE_FILE);
  await copyFile(join(repoRoot, "workspaces", "bid-sample", SAMPLE_FILE), source);
  const workingCopy = join(directory, "副本-批注.docx");
  const mirrored = join(directory, "副本-批注-已处置.docx");

  await writeBidComments({
    sourcePath: source,
    outputPath: workingCopy,
    comments: [
      { id: "F-1", author: "审查", text: "【警告】问题1\n报价与明细不符", blockIndex: 0 },
      { id: "F-2", author: "审查", text: "【警告】问题2\n少了盖章页", blockIndex: 1 },
    ],
  });
  const written = await docxParser.parse(workingCopy);
  expect(written.parsed.comments).toHaveLength(2);

  const accepted = disposeFinding(ledgerOf([{}, {}]), {
    findingId: "F-1",
    disposition: "accepted",
    note: "确认属实",
  });
  expect(accepted.status).toBe("recorded");
  if (accepted.status !== "recorded") return;
  const rejected = disposeFinding(accepted.ledger, {
    findingId: "F-2",
    disposition: "rejected",
    note: "招标文件未作要求",
  });
  expect(rejected.status).toBe("recorded");
  if (rejected.status !== "recorded") return;

  const plan = planDispositionMirror(written.parsed.comments, rejected.ledger);
  expect(plan.unmatched).toEqual([]);
  const result = await docxDispositionMirror.mirror({
    sourcePath: workingCopy,
    outputPath: mirrored,
    plan,
  });
  expect(result.mirrored).toBe(2);
  expect(result.replies).toBe(2);

  const after = await docxParser.parse(mirrored);
  const byText = (needle: string) =>
    after.parsed.comments.find((comment) => comment.text.includes(needle));

  // The accepted one is marked resolved; the rejected one keeps its reason only.
  expect(byText("问题1")?.done).toBe(true);
  // "Not resolved" is the absence of the flag, not a stored false.
  expect(byText("问题2")?.done ?? false).toBe(false);
  const acceptedReply = byText("已采纳：确认属实");
  const rejectedReply = byText("已驳回：招标文件未作要求");
  expect(acceptedReply).toBeDefined();
  expect(rejectedReply).toBeDefined();
  // A reply points at the comment it answers.
  expect(acceptedReply?.parentId).toBe(byText("问题1")?.id);

  // The working copy it mirrored from is untouched.
  expect((await docxParser.parse(workingCopy)).parsed.comments.map((c) => c.done)).toEqual([
    undefined,
    undefined,
  ]);
  expect((await readFile(workingCopy)).byteLength).toBeGreaterThan(0);
});
