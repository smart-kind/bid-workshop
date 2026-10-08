import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { buildLedger, disposeFinding, runHeader, type FindingInput } from "../ledger";
import { renderMarkdownReport, writeReviewReport } from "../report";

/** T-27: the report is a real file, with the run header and every entry in it. */

function ledgerOf(entries: Partial<FindingInput>[]) {
  return buildLedger(
    runHeader({
      runId: "run-1",
      startedAt: "2026-10-08T00:00:00.000Z",
      documentPath: "/w/招标文件/招标书.docx",
      documentFingerprint: "fp123",
      skills: [{ id: "bid-qualification", fingerprint: "s1" }],
      criteria: { file: "评审条件.md", fingerprint: "c1" },
      model: "test-model",
    }),
    entries.map((entry, index) => ({
      id: `F-${index + 1}`,
      severity: "warning",
      check: `判据 ${index + 1}`,
      verdict: "not-satisfied",
      problem: `问题 ${index + 1}`,
      basis: `评审条件 ${index + 1}`,
      location: { blockIndex: index, quote: "摘录" },
      ...entry,
    })),
  );
}

test("writes the report to disk with the run header, every entry and its disposition", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bid-report-"));
  const ledger = ledgerOf([
    { severity: "critical" },
    { severity: "info", location: { blockIndex: 5, cell: { row: 3, column: 2, label: "合计" } } },
  ]);
  const accepted = disposeFinding(ledger, {
    findingId: "F-1",
    disposition: "accepted",
    note: "确认属实",
  });
  expect(accepted.status).toBe("recorded");
  if (accepted.status !== "recorded") return;

  const result = await writeReviewReport({
    ledger: accepted.ledger,
    directory,
    format: "markdown",
  });

  expect(result.outputPath).toBe(join(directory, "审查报告-fp123.md"));
  expect(result.entries).toBe(2);

  const body = await readFile(result.outputPath, "utf8");
  // The header says which run this was.
  expect(body).toContain("/w/招标文件/招标书.docx");
  expect(body).toContain("fp123");
  expect(body).toContain("评审条件.md");
  expect(body).toContain("bid-qualification");
  expect(body).toContain("test-model");
  // Entries are grouped by severity, with basis, place and disposition.
  expect(body).toContain("## 严重（1）");
  expect(body).toContain("## 提示（1）");
  expect(body).toContain("问题 1");
  expect(body).toContain("问题 2");
  expect(body).toContain("依据：评审条件 1");
  expect(body).toContain("段落 0");
  expect(body).toContain("第3行 合计");
  expect(body).toContain("处置：已采纳（确认属实）");
  expect(body).toContain("处置：待定");
});

test("writes html for the same data, and never a path it did not write", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bid-report-html-"));
  const ledger = ledgerOf([{ severity: "warning" }]);

  const result = await writeReviewReport({ ledger, directory, format: "html" });
  const body = await readFile(result.outputPath, "utf8");

  expect(result.outputPath.endsWith(".html")).toBe(true);
  expect(body).toContain("<table>");
  expect(body).toContain("问题 1");
  expect(body).toContain("待定");
  // The markdown renderer is a pure function of the ledger.
  expect(renderMarkdownReport(ledger)).toContain("# 投标审查报告");
});

test("a report name carries the document fingerprint so two reviews do not collide", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bid-report-names-"));
  const first = ledgerOf([{}]);
  const second = ledgerOf([{}]);
  const other = buildLedger(
    runHeader({
      runId: "run-2",
      startedAt: "2026-10-08T02:00:00.000Z",
      documentPath: "/w/另一份.docx",
      documentFingerprint: "fp999",
    }),
    second.findings.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      check: finding.check,
      verdict: finding.verdict,
      problem: finding.problem ?? "x",
    })),
  );

  const a = await writeReviewReport({ ledger: first, directory, format: "markdown" });
  const b = await writeReviewReport({ ledger: other, directory, format: "markdown" });

  expect(a.outputPath).not.toBe(b.outputPath);
  expect(a.outputPath).toContain("fp123");
  expect(b.outputPath).toContain("fp999");
});
