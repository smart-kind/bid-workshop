import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BidDocument, BidIssue } from "./contract";
import type { LoadedBid } from "./document";

/** Review conditions file, looked up beside the document being reviewed. */
export const CRITERIA_FILE = "评审条件.md";

/** Used when the workspace has no conditions file. */
export const DEFAULT_CRITERIA = `# 标书评审条件（默认）

## 一、资质审查
- 必须包含有效的营业执照信息，并附相应证明
- 必须具备相关行业资质证明
- 凡声称「详见附件」的证明材料必须实际随附

## 二、技术方案
- 必须包含完整的实施方案
- 必须有项目管理计划
- 必须有质量保证措施

## 三、商务审查
- 报价必须包含分项明细
- 总价必须与分项明细合计一致
- 必须有报价有效期承诺

## 四、格式审查
- 必须有目录与页码
- 必须在文件末尾签章（投标人盖章、法定代表人或授权代表签字）`;

export interface CriteriaSource {
  text: string;
  path: string | null;
}

/** Read the review conditions next to the document, or fall back to the default list. */
export function readCriteria(documentPath: string): CriteriaSource {
  const candidate = join(dirname(documentPath), CRITERIA_FILE);
  if (existsSync(candidate)) {
    return { text: readFileSync(candidate, "utf8").trim(), path: candidate };
  }
  return { text: DEFAULT_CRITERIA, path: null };
}

/** What the model reports for one finding. Mirrors the fields the panel renders,
 *  plus the block index a later step needs to anchor a Word comment. */
export interface FindingInput {
  id: string;
  severity: "critical" | "warning" | "info";
  category: string;
  title: string;
  description: string;
  section?: string;
  blockIndex?: number;
  quote?: string;
  basis?: string;
  suggestion?: string;
}

export function toBidIssue(finding: FindingInput): BidIssue {
  const location: BidIssue["location"] = {};
  if (finding.section !== undefined) location.section = finding.section;
  if (finding.blockIndex !== undefined) location.blockIndex = finding.blockIndex;
  if (finding.quote !== undefined) location.quote = finding.quote;

  const issue: BidIssue = {
    id: finding.id,
    severity: finding.severity,
    category: finding.category,
    title: finding.title,
    description: finding.description,
  };
  if (Object.keys(location).length > 0) issue.location = location;
  if (finding.basis !== undefined) issue.basis = finding.basis;
  if (finding.suggestion !== undefined) issue.suggestion = finding.suggestion;
  return issue;
}

/**
 * The instruction handed to the model to run one review. The model does the
 * reading and judging; the extension only supplies the document, the conditions
 * and the shape its conclusions must come back in.
 */
export function buildReviewBrief(
  doc: BidDocument,
  bid: LoadedBid,
  criteria: CriteriaSource,
  textBudget: number,
): string {
  const truncated = bid.text.length > textBudget;
  const body = truncated ? `${bid.text.slice(0, textBudget)}\n……（正文过长，已截断）` : bid.text;
  const criteriaOrigin = criteria.path
    ? `来自 ${criteria.path}`
    : "工作空间内没有评审条件文件，使用内置默认条件";

  return [
    `请审查这份投标文件：${doc.name}`,
    "",
    "## 审查条件",
    criteriaOrigin,
    "",
    criteria.text,
    "",
    "## 投标文件正文",
    `（${bid.blockCount} 个块，${bid.tableCount} 张表；块序号按正文顺序从 0 开始，用于定位）`,
    "",
    body,
    "",
    "## 怎么做",
    "1. 按审查条件的每一项逐条核对，不要只看形式，要核对数字、名称、日期是否自洽。",
    "2. 每条结论调用一次 `bid_record_findings`，一次提交本次审查的全部发现。",
    "3. 每条结论给出：严重度（critical/warning/info）、类别、标题、问题描述、",
    "   位置（章节名 + blockIndex + 原文摘录）、依据（对应审查条件的哪一条）、修改建议。",
    "4. 数字对不上、声称有附件却没有、要求写了却没写，这类都算问题。",
    "5. 提交后调用 `bid_export_report` 可以登记报告。",
  ].join("\n");
}
