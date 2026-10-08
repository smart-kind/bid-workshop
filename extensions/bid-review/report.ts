import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dispositionLabel, type Finding, type Ledger } from "./ledger";

/**
 * The review report: the run header, the entries grouped by severity, and what
 * happened to each one. Markdown is the main form; HTML is offered for the same
 * data. Nothing here invents a path — a report that cannot be written says so.
 */

const SEVERITY_LABELS: Readonly<Record<Finding["severity"], string>> = {
  critical: "严重",
  warning: "警告",
  info: "提示",
};

const SEVERITY_ORDER: readonly Finding["severity"][] = ["critical", "warning", "info"];

function grouped(findings: readonly Finding[]): Array<[Finding["severity"], Finding[]]> {
  return SEVERITY_ORDER.map((severity) => [
    severity,
    findings.filter((finding) => finding.severity === severity),
  ]);
}

function locationLine(finding: Finding): string | undefined {
  const location = finding.location;
  if (!location) return undefined;
  const parts: string[] = [];
  if (location.section) parts.push(location.section);
  if (location.blockIndex !== undefined) parts.push(`段落 ${location.blockIndex}`);
  if (location.cell) {
    parts.push(`第${location.cell.row}行${location.cell.label ? ` ${location.cell.label}` : ""}`);
  }
  if (location.quote) parts.push(`「${location.quote}」`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function entryLines(finding: Finding, bullet: string): string[] {
  const lines = [`${bullet} **${finding.id}** ${finding.problem ?? finding.check}`];
  lines.push(`${bullet}   - 判据：${finding.check}`);
  const where = locationLine(finding);
  if (where) lines.push(`${bullet}   - 位置：${where}`);
  if (finding.basis) lines.push(`${bullet}   - 依据：${finding.basis}`);
  if (finding.advice) lines.push(`${bullet}   - 建议：${finding.advice}`);
  lines.push(
    `${bullet}   - 处置：${dispositionLabel(finding.disposition)}${
      finding.dispositionNote ? `（${finding.dispositionNote}）` : ""
    }`,
  );
  return lines;
}

export function renderMarkdownReport(ledger: Ledger): string {
  const { header } = ledger;
  const lines: string[] = [];
  lines.push("# 投标审查报告");
  lines.push("");
  lines.push(`- 文档：${header.documentPath}`);
  lines.push(`- 文档指纹：${header.documentFingerprint}`);
  lines.push(`- 审查时间：${header.startedAt}`);
  if (header.model) lines.push(`- 模型：${header.model}`);
  if (header.criteria) {
    lines.push(
      `- 判据：${header.criteria.file}${header.criteria.fingerprint ? `（${header.criteria.fingerprint}）` : ""}`,
    );
  }
  if (header.skills.length > 0) {
    lines.push(
      `- 技能：${header.skills
        .map((skill) => `${skill.id}${skill.fingerprint ? `（${skill.fingerprint}）` : ""}`)
        .join("、")}`,
    );
  }
  lines.push(`- 条目：${ledger.findings.length} 条`);
  lines.push("");
  for (const [severity, findings] of grouped(ledger.findings)) {
    if (findings.length === 0) continue;
    lines.push(`## ${SEVERITY_LABELS[severity]}（${findings.length}）`);
    lines.push("");
    for (const finding of findings) {
      lines.push(...entryLines(finding, "-"));
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderHtmlReport(ledger: Ledger): string {
  const { header } = ledger;
  const rows = ledger.findings.map((finding) => {
    const where = locationLine(finding);
    return `<tr><td>${escapeHtml(SEVERITY_LABELS[finding.severity])}</td><td>${escapeHtml(finding.id)}</td><td>${escapeHtml(finding.problem ?? finding.check)}</td><td>${escapeHtml(where ?? "")}</td><td>${escapeHtml(dispositionLabel(finding.disposition))}</td></tr>`;
  });
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><title>投标审查报告</title></head>
<body>
<h1>投标审查报告</h1>
<p>文档：${escapeHtml(header.documentPath)}（${escapeHtml(header.documentFingerprint)}）</p>
<p>审查时间：${escapeHtml(header.startedAt)}｜条目：${ledger.findings.length} 条</p>
<table>
<thead><tr><th>严重度</th><th>编号</th><th>问题</th><th>位置</th><th>处置</th></tr></thead>
<tbody>
${rows.join("\n")}
</tbody>
</table>
</body>
</html>
`;
}

export type ReportFormat = "markdown" | "html";

export interface ReportWriteResult {
  readonly outputPath: string;
  readonly format: ReportFormat;
  readonly entries: number;
}

/**
 * Render the report and write it where it belongs. The file name carries the
 * document's fingerprint, so two reviews of different documents never overwrite
 * each other's report.
 */
export async function writeReviewReport(input: {
  readonly ledger: Ledger;
  readonly directory: string;
  readonly format: ReportFormat;
}): Promise<ReportWriteResult> {
  const extension = input.format === "html" ? "html" : "md";
  const outputPath = join(
    input.directory,
    `审查报告-${input.ledger.header.documentFingerprint}.${extension}`,
  );
  const body =
    input.format === "html" ? renderHtmlReport(input.ledger) : renderMarkdownReport(input.ledger);
  await writeFile(outputPath, body, "utf8");
  return { outputPath, format: input.format, entries: input.ledger.findings.length };
}
