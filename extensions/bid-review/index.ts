import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { defineFacet } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerDesktopView } from "@bid-workshop/extension-ui";
import { BidReview, type BidDocument, type BidIssue, type BidReviewState } from "./contract";
import {
  describeBid,
  loadBidDocument,
  setBidCommentWriter,
  setBidDocumentParser,
  type BidComment,
  type BidCommentAnchor,
  type LoadedBid,
} from "./document";
import { describeWorkingCopyFailure, writeBidWorkingCopy } from "./working-copy";
import { describeRunDiff, diffLedgers } from "./run-diff";
import { describeCommentSync, planDispositionMirror } from "./comment-mirror";
import { renderMarkdownReport, writeReviewReport } from "./report";
import { FINALIZE_NOTE, finalizeBidDocument } from "./finalize";
import { describeRunSkills, resolveRunSkills } from "./skills-index";
import { describeRunCapabilities, resolveRunCapabilities } from "./mcp-index";
import {
  applyOrganization,
  initWorkspaceGit,
  planOrganization,
  readProfileZones,
  writeCriteriaSkeleton,
  writeProfileSkeleton,
} from "./organize";
import { docxDispositionMirror } from "./parser-docx.mjs";
import {
  buildLedger,
  disposeFinding,
  dispositionProgress,
  runHeader,
  type DispositionProgress,
  type FindingInput as LedgerFindingInput,
  type FindingLocation,
  type Ledger,
} from "./ledger";
import { docxCommentWriter, docxParser } from "./parser-docx.mjs";
import {
  buildReviewBrief,
  commentBody,
  readCriteria,
  toBidIssue,
  type FindingInput,
} from "./review";

// Install the document engine adapters once, at module load. Everything below
// talks to the parser and writer interfaces rather than to the engine.
setBidDocumentParser(docxParser);
setBidCommentWriter(docxCommentWriter);

/** Parsed documents, keyed by document id. Kept out of the replicated state,
 *  which has to stay serializable, so a later step can write comments back
 *  without parsing the file again. */
const loadedBids = new Map<string, LoadedBid>();

/** Characters of document text handed to the model in a single tool result. */
const TEXT_BUDGET = 60_000;

/** Details reported by bid_load_document. Declared so the success and failure
 *  branches agree on the tool result type. */
interface LoadDocumentDetails {
  id: string;
  name: string;
  sections: string[];
  blockCount: number;
  tableCount: number;
  charCount: number;
  truncated: boolean;
  error?: string;
}

/** The session workspace, learned at session start. */
let sessionCwd: string | null = null;

/**
 * The panel only knows file names, so a relative path is resolved against the
 * session workspace. Falling back to the process cwd would look for the file
 * beside the app instead of in the workspace the user is working in.
 */
function resolveDocumentPath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(sessionCwd ?? process.cwd(), filePath);
}

/** Author shown on the comments written into the document. */
const COMMENT_AUTHOR = "AI 审查助手";

/** Findings that can be anchored in the document, and those that cannot. */
function collectCommentAnchors(issues: BidIssue[]): {
  anchors: BidCommentAnchor[];
  unanchored: string[];
} {
  const anchors: BidCommentAnchor[] = [];
  const unanchored: string[] = [];
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  for (const issue of issues) {
    const blockIndex = issue.location?.blockIndex;
    if (blockIndex === undefined) {
      unanchored.push(issue.id);
      continue;
    }
    const anchor: BidCommentAnchor = {
      id: issue.id,
      author: COMMENT_AUTHOR,
      date: now,
      text: commentBody(issue),
      blockIndex,
    };
    if (issue.location?.quote !== undefined) anchor.quote = issue.location.quote;
    if (issue.location?.cell !== undefined) anchor.cell = issue.location.cell;
    anchors.push(anchor);
  }
  return { anchors, unanchored };
}

/** Where an annotated copy of a document goes when the caller does not say. */
/** Details reported by bid_start_review, shared by both branches. */
interface StartReviewDetails {
  fileIds: string[];
  error?: string;
}

/** The finding shape the model submits to bid_record_findings. */
const FINDING = Type.Object({
  id: Type.String({ minLength: 1, description: "唯一编号，例如 F-1" }),
  severity: Type.Union([Type.Literal("critical"), Type.Literal("warning"), Type.Literal("info")]),
  category: Type.String({
    description: "类别：qualification / pricing / technical / legal / format",
  }),
  title: Type.String({ minLength: 1, description: "一句话概括问题" }),
  description: Type.String({ minLength: 1, description: "问题描述，写清依据什么判断" }),
  section: Type.Optional(Type.String({ description: "所在章节名" })),
  blockIndex: Type.Optional(
    Type.Number({ description: "正文块序号（从 0 开始），用于把批注锚到具体段落" }),
  ),
  quote: Type.Optional(Type.String({ description: "最小必要的原文摘录" })),
  basis: Type.Optional(Type.String({ description: "依据：对应审查条件的哪一条" })),
  suggestion: Type.Optional(Type.String({ description: "修改建议" })),
  sources: Type.Optional(
    Type.Array(
      Type.Object({
        kind: Type.Union([Type.Literal("mcp"), Type.Literal("skill"), Type.Literal("document")]),
        name: Type.String({ minLength: 1, description: "来源名称，例如 MCP server 名" }),
        at: Type.Optional(Type.String({ description: "查阅时间（ISO）" })),
      }),
      { description: "结论依据的来源，便于复核（R6）" },
    ),
  ),
});

/** Parse a .docx and register it as a loaded document. */
async function ingestDocument(inputPath: string): Promise<BidDocument> {
  const bid = await loadBidDocument(resolveDocumentPath(inputPath));
  const loaded: BidDocument = {
    id: crypto.randomUUID(),
    name: bid.name,
    path: bid.path,
    size: bid.size,
    loadedAt: Date.now(),
    sections: bid.outline.map((entry) => entry.title),
    blockCount: bid.blockCount,
    tableCount: bid.tableCount,
    charCount: bid.charCount,
  };
  loadedBids.set(loaded.id, bid);
  return loaded;
}

/** The ledger of the latest run: the record dispositions are written into. */
let currentLedger: Ledger | null = null;

/** The working copy the last write produced: what dispositions mirror onto. */
let lastWorkingCopy: string | null = null;

/** The skills the last run rested on, so a later step can name them. */
let runSkills: Awaited<ReturnType<typeof resolveRunSkills>> | null = null;

/** The data sources the last run could reach, and the ones the profile wanted. */
let runCapabilities: Awaited<ReturnType<typeof resolveRunCapabilities>> | null = null;

/**
 * The submitted finding as a ledger entry. Until the tool's own schema carries a
 * verdict, everything recorded is a problem — which is what makes `problem`
 * required here rather than optional.
 */
function toLedgerInput(finding: {
  id: string;
  severity: string;
  category: string;
  title: string;
  description: string;
  section?: string;
  blockIndex?: number;
  quote?: string;
  basis?: string;
  suggestion?: string;
  sources?: readonly { kind: "mcp" | "skill" | "document"; name: string; at?: string }[];
}): LedgerFindingInput {
  const location: FindingLocation = {};
  if (finding.section !== undefined) location.section = finding.section;
  if (finding.blockIndex !== undefined) location.blockIndex = finding.blockIndex;
  if (finding.quote !== undefined) location.quote = finding.quote;
  return {
    id: finding.id,
    severity: finding.severity,
    check: finding.basis ?? finding.category,
    verdict: "not-satisfied",
    problem: finding.title,
    ...(finding.basis ? { basis: finding.basis } : {}),
    ...(Object.keys(location).length > 0 ? { location } : {}),
    ...(finding.suggestion ? { advice: finding.suggestion } : {}),
    ...(finding.sources && finding.sources.length > 0 ? { sources: finding.sources } : {}),
  };
}

/** The document's content digest, so a run says which bytes it judged. */
async function documentFingerprint(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

/** The goal the workspace's profile declares, when it declares one. */
/** What the working copy already says, when a previous round wrote it. */
async function readPreviousComments(): Promise<readonly BidComment[] | undefined> {
  if (!lastWorkingCopy) return undefined;
  try {
    const parsed = await docxParser.parse(lastWorkingCopy);
    return parsed.parsed.comments.length > 0 ? parsed.parsed.comments : undefined;
  } catch {
    return undefined;
  }
}

async function readDeclaredGoal(): Promise<string | undefined> {
  const workspacePath = sessionCwd;
  if (!workspacePath) return undefined;
  try {
    const raw = await readFile(join(workspacePath, ".bid", "workspace.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const goal = (parsed as { goal?: unknown }).goal;
    return typeof goal === "string" && goal.trim() ? goal.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** A short digest of a file's text, for the criteria version a run used. */
function fingerprintText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function initialState(): BidReviewState {
  return {
    loadedFiles: [],
    reviewStatus: "idle",
    issues: [],
    summary: null,
    progress: 0,
    lastError: null,
  };
}

/** Documents currently under review, by document id. */
const reviewingBids = new Map<string, { doc: BidDocument; bid: LoadedBid }>();

export default function bidReview(pi: ExtensionAPI) {
  let ctx: ExtensionContext | null = null;
  let snapshot = initialState();
  const listeners = new Set<(state: BidReviewState) => void>();
  const publish = (next: BidReviewState) => {
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
  };
  const getSnapshot = () => snapshot;

  pi.on("session_start", (_event, context) => {
    ctx = context;
    sessionCwd = context.cwd ?? null;
    publish(initialState());
  });

  pi.on("session_tree", (_event, context) => {
    ctx = context;
    sessionCwd = context.cwd ?? null;
    publish(initialState());
  });

  pi.registerTool({
    name: "bid_load_document",
    label: "Load bid document",
    description:
      "Load a bid document (.docx): returns the section outline and the full text, so it can be reviewed",
    parameters: Type.Object({
      filePath: Type.String({
        minLength: 1,
        maxLength: 2048,
        description: "Path to the bid document file",
      }),
    }),
    async execute(_id, input) {
      try {
        const doc = await ingestDocument(input.filePath);
        publish({
          ...snapshot,
          loadedFiles: [...snapshot.loadedFiles, doc],
          lastError: null,
        });
        const bid = loadedBids.get(doc.id)!;
        const truncated = bid.text.length > TEXT_BUDGET;
        const body = truncated
          ? `${bid.text.slice(0, TEXT_BUDGET)}\n……（正文过长，已截断）`
          : bid.text;
        const details: LoadDocumentDetails = {
          id: doc.id,
          name: doc.name,
          sections: doc.sections,
          blockCount: doc.blockCount,
          tableCount: doc.tableCount,
          charCount: doc.charCount,
          truncated,
        };
        return {
          content: [{ type: "text", text: `${describeBid(bid)}\n\n--- 正文 ---\n${body}` }],
          details,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        publish({ ...snapshot, lastError: message });
        const details: LoadDocumentDetails = {
          id: "",
          name: input.filePath,
          sections: [],
          blockCount: 0,
          tableCount: 0,
          charCount: 0,
          truncated: false,
          error: message,
        };
        return {
          content: [{ type: "text", text: `无法加载 ${input.filePath}：${message}` }],
          details,
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "bid_start_review",
    label: "Start bid review",
    description:
      "Start reviewing a loaded bid document: returns the review conditions together with the document text to judge them against",
    parameters: Type.Object({
      fileIds: Type.Array(Type.String(), { minItems: 1, maxItems: 20 }),
    }),
    async execute(_id, input) {
      reviewingBids.clear();
      const briefs: string[] = [];
      for (const fileId of input.fileIds) {
        const doc = snapshot.loadedFiles.find((file) => file.id === fileId);
        const bid = loadedBids.get(fileId);
        if (!doc || !bid) continue;
        reviewingBids.set(fileId, { doc, bid });
        briefs.push(
          buildReviewBrief(
            doc,
            bid,
            readCriteria(doc.path),
            TEXT_BUDGET,
            await readDeclaredGoal(),
            await readPreviousComments(),
          ),
        );
      }

      if (briefs.length === 0) {
        const message = "没有可审查的文档：请先用 bid_load_document 加载标书";
        publish({ ...snapshot, lastError: message });
        const details: StartReviewDetails = { fileIds: input.fileIds, error: message };
        return {
          content: [{ type: "text", text: message }],
          details,
          isError: true,
        };
      }

      publish({
        ...snapshot,
        reviewStatus: "reviewing",
        progress: 0,
        issues: [],
        summary: null,
        lastError: null,
      });
      const details: StartReviewDetails = { fileIds: [...reviewingBids.keys()] };
      return {
        content: [{ type: "text", text: briefs.join("\n\n---\n\n") }],
        details,
      };
    },
  });

  pi.registerTool({
    name: "bid_record_findings",
    label: "Record bid review findings",
    description:
      "Submit the findings of the current bid review. Call once per review, with every finding from that review",
    parameters: Type.Object({
      findings: Type.Array(FINDING, { minItems: 1 }),
      summary: Type.Optional(Type.String({ description: "整份标书的总体结论" })),
    }),
    async execute(_id, input) {
      const issues = input.findings.map(toBidIssue);
      const doc = snapshot.loadedFiles[snapshot.loadedFiles.length - 1];

      // The ledger is built before anything is published: a submission that is
      // not a usable record is reported instead of being half-stored.
      let ledger: Ledger | null = null;
      if (doc) {
        const criteria = readCriteria(doc.path);
        // The workspace's enable-list, resolved against what is really there:
        // a skill the profile asked for and the workspace lacks is reported.
        runSkills = await resolveRunSkills({
          workspacePath: sessionCwd ?? dirname(resolve(doc.path)),
        });
        const header = runHeader({
          runId: crypto.randomUUID(),
          startedAt: new Date().toISOString(),
          documentPath: doc.path,
          documentFingerprint: await documentFingerprint(doc.path),
          skills: runSkills.skills,
          ...(criteria.path
            ? {
                criteria: {
                  file: criteria.path,
                  ...(criteria.text ? { fingerprint: fingerprintText(criteria.text) } : {}),
                },
              }
            : {}),
        });
        try {
          ledger = buildLedger(header, input.findings.map(toLedgerInput));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          publish({ ...snapshot, lastError: message });
          return {
            content: [{ type: "text", text: message }],
            details: { count: 0, critical: 0, warning: 0, info: 0 },
            isError: true,
          };
        }
      }
      // Only compare against a previous run of the same document: a different
      // file's findings are not a change, they are a different review.
      const previous = currentLedger;
      const diff =
        ledger &&
        previous &&
        previous.header.documentFingerprint === ledger.header.documentFingerprint
          ? diffLedgers(previous, ledger)
          : null;
      currentLedger = ledger;

      publish({
        ...snapshot,
        reviewStatus: "done",
        progress: 100,
        issues,
        summary: input.summary ?? null,
        lastError: null,
      });
      const counts = { critical: 0, warning: 0, info: 0 };
      for (const issue of issues) counts[issue.severity]++;
      const progress = ledger ? dispositionProgress(ledger) : null;
      return {
        content: [
          {
            type: "text",
            text: `已记录 ${issues.length} 条结论（严重 ${counts.critical} / 警告 ${counts.warning} / 提示 ${counts.info}），${progress?.pending ?? 0} 条待处置${diff ? `；与上一轮相比：${describeRunDiff(diff)}` : ""}${runSkills ? `；${describeRunSkills(runSkills)}` : ""}${runCapabilities ? `；${describeRunCapabilities(runCapabilities)}` : ""}`,
          },
        ],
        details: {
          count: issues.length,
          ...counts,
          ...(progress ? { progress } : {}),
          ...(diff ? { diff: diff.counts } : {}),
          ...(runSkills ? { skills: runSkills.skills, missingSkills: runSkills.missing } : {}),
          ...(runCapabilities
            ? { mcpServers: runCapabilities.servers, missingMcpServers: runCapabilities.missing }
            : {}),
        },
      };
    },
  });

  pi.registerTool({
    name: "bid_dispose_finding",
    label: "Dispose one review finding",
    description:
      "Record what happened to one finding of the latest review: accepted, rejected or back to pending. A rejection must say why",
    parameters: Type.Object({
      findingId: Type.String({ minLength: 1, description: "条目编号，例如 F-1" }),
      disposition: Type.Union([
        Type.Literal("pending"),
        Type.Literal("accepted"),
        Type.Literal("rejected"),
      ]),
      note: Type.Optional(Type.String({ description: "处置说明；驳回时必填" })),
    }),
    async execute(_id, input) {
      if (!currentLedger) {
        return {
          content: [{ type: "text", text: "还没有台账：请先用 bid_record_findings 记录结论" }],
          details: { disposed: 0, progress: null as DispositionProgress | null },
          isError: true,
        };
      }
      const result = disposeFinding(currentLedger, {
        findingId: input.findingId,
        disposition: input.disposition,
        ...(input.note === undefined ? {} : { note: input.note }),
      });
      if (result.status === "refused") {
        return {
          content: [{ type: "text", text: result.reason }],
          details: { disposed: 0, progress: dispositionProgress(currentLedger) },
          isError: true,
        };
      }
      currentLedger = result.ledger;
      publish({ ...snapshot });
      const { total, accepted, rejected, pending } = result.progress;
      return {
        content: [
          {
            type: "text",
            text: `${input.findingId} 已标记为${
              input.disposition === "accepted"
                ? "采纳"
                : input.disposition === "rejected"
                  ? "驳回"
                  : "待定"
            }；进度 ${accepted + rejected}/${total}（采纳 ${accepted} / 驳回 ${rejected} / 待定 ${pending}）`,
          },
        ],
        details: { disposed: 1, progress: result.progress },
      };
    },
  });

  pi.registerTool({
    name: "bid_organize_workspace",
    label: "Organize the workspace",
    description:
      "Put the workspace's files where its zones say they belong. Previews by default; only apply moves anything. Contents are never changed",
    parameters: Type.Object({
      apply: Type.Optional(Type.Boolean({ description: "true 才真正执行；默认只预览" })),
      generateSkeletons: Type.Optional(
        Type.Boolean({ description: "缺少判据文件/业务档案时生成骨架（不覆盖已有）" }),
      ),
      initGit: Type.Optional(
        Type.Boolean({ description: "未纳入版本控制时 git init；无 git 时静默跳过" }),
      ),
    }),
    async execute(_id, input) {
      const workspacePath = sessionCwd;
      if (!workspacePath) {
        return {
          content: [{ type: "text", text: "不知道当前工作区：无法整理" }],
          details: { actions: 0, applied: 0, conflicts: [] },
          isError: true,
        };
      }
      const zones = await readProfileZones(workspacePath);
      const plan = await planOrganization({ workspacePath, zones });
      if (!input.apply) {
        const lines = plan.actions.map((action) => `- ${action.reason}`);
        return {
          content: [
            {
              type: "text",
              text:
                plan.actions.length === 0
                  ? "整理预览：没有需要改动的项。"
                  : `整理预览（未执行）：\n${lines.join("\n")}`,
            },
          ],
          details: { actions: plan.actions.length, applied: 0, conflicts: [] },
        };
      }

      const result = await applyOrganization(workspacePath, plan);
      const extras: string[] = [];
      if (input.generateSkeletons) {
        const criteria = await writeCriteriaSkeleton(workspacePath);
        const profile = await writeProfileSkeleton(workspacePath, zones);
        extras.push(
          criteria.status === "written" ? "已生成判据骨架" : criteria.reason,
          profile.status === "written" ? "已生成业务档案" : profile.reason,
        );
      }
      if (input.initGit) {
        const git = await initWorkspaceGit(workspacePath);
        extras.push(
          git.status === "created"
            ? "已初始化 git"
            : git.status === "present"
              ? "已在版本控制中"
              : `未初始化版本控制（${git.reason}）`,
        );
      }
      const conflictNote =
        result.conflicts.length > 0
          ? `；${result.conflicts.length} 项未执行：${result.conflicts.map((entry) => entry.reason).join("；")}`
          : "";
      return {
        content: [
          {
            type: "text",
            text: `整理已执行 ${result.applied.length} 项${conflictNote}${
              extras.length > 0 ? `；${extras.join("；")}` : ""
            }`,
          },
        ],
        details: {
          actions: plan.actions.length,
          applied: result.applied.length,
          conflicts: result.conflicts.map((entry) => entry.reason),
        },
      };
    },
  });

  pi.registerTool({
    name: "bid_finalize_document",
    label: "Finalise the reviewed document",
    description:
      "Save a final copy of the working copy, carrying the comments and the disposition record. The original and the working copy are both kept, and the document's text is not rewritten",
    parameters: Type.Object({
      filePath: Type.Optional(
        Type.String({ description: "工作副本路径；省略则用最近一次写出的副本" }),
      ),
      outputDirectory: Type.Optional(
        Type.String({ description: "定稿输出目录；省略则与原副本同目录" }),
      ),
      date: Type.Optional(Type.String({ description: "YYYY-MM-DD；省略则用当天" })),
    }),
    async execute(_id, input) {
      const copyPath = input.filePath ?? lastWorkingCopy;
      if (!copyPath) {
        return {
          content: [{ type: "text", text: "还没有工作副本：请先用 bid_write_comments 写出" }],
          details: { outputPath: "" },
          isError: true,
        };
      }
      try {
        const result = await finalizeBidDocument({
          copyPath,
          ...(input.outputDirectory ? { outputDirectory: input.outputDirectory } : {}),
          date: input.date ?? new Date().toISOString().slice(0, 10),
        });
        return {
          content: [{ type: "text", text: `已生成定稿 ${result.outputPath}。${FINALIZE_NOTE}` }],
          details: { outputPath: result.outputPath },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `定稿失败：${message}` }],
          details: { outputPath: "" },
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "bid_sync_comments",
    label: "Sync dispositions with the working copy",
    description:
      "Mirror the ledger's dispositions onto the working copy's comments (mark resolved, append the reason) and report where the document disagrees. Explicit and one-way: the ledger stays the authority",
    parameters: Type.Object({
      filePath: Type.Optional(
        Type.String({ description: "工作副本路径；省略则用最近一次写出的副本" }),
      ),
    }),
    async execute(_id, input) {
      const sourcePath = input.filePath ?? lastWorkingCopy;
      if (!sourcePath) {
        return {
          content: [{ type: "text", text: "还没有工作副本：请先用 bid_write_comments 写出" }],
          details: { mirrored: 0, unmatched: [], disagreements: 0 },
          isError: true,
        };
      }
      if (!currentLedger) {
        return {
          content: [{ type: "text", text: "还没有台账：请先用 bid_record_findings 记录结论" }],
          details: { mirrored: 0, unmatched: [], disagreements: 0 },
          isError: true,
        };
      }

      const parsed = await docxParser.parse(sourcePath);
      const plan = planDispositionMirror(parsed.parsed.comments, currentLedger);
      const outputPath = sourcePath.replace(/\.docx$/i, "") + "-已处置.docx";
      const result = await docxDispositionMirror.mirror({ sourcePath, outputPath, plan });
      const rows = describeCommentSync(parsed.parsed.comments, currentLedger);
      const disagreements = rows.filter((row) => row.disagrees).length;
      const unmatchedNote =
        plan.unmatched.length > 0 ? `；${plan.unmatched.length} 条在文档里找不到对应批注` : "";
      return {
        content: [
          {
            type: "text",
            text: `已把 ${result.mirrored} 条处置写回批注（含 ${result.replies} 条回复）到 ${result.outputPath}${unmatchedNote}；文档与台账不一致 ${disagreements} 处（台账为准，未自动改动）`,
          },
        ],
        details: { mirrored: result.mirrored, unmatched: plan.unmatched, disagreements },
      };
    },
  });

  pi.registerTool({
    name: "bid_write_comments",
    label: "Write findings as Word comments",
    description:
      "Write the recorded findings into a copy of the bid document as native Word comments, anchored at the paragraphs they were found in",
    parameters: Type.Object({
      fileId: Type.Optional(Type.String({ description: "文档 id；省略则用最近一次加载的标书" })),
      outputDirectory: Type.Optional(
        Type.String({
          description:
            "输出目录；省略则写在原稿旁。副本命名沿用工作区交付规则（默认「…-批注.docx」）",
        }),
      ),
    }),
    async execute(_id, input) {
      const doc = input.fileId
        ? snapshot.loadedFiles.find((file) => file.id === input.fileId)
        : snapshot.loadedFiles[snapshot.loadedFiles.length - 1];

      if (!doc) {
        const message = "没有已加载的标书：请先用 bid_load_document 加载";
        publish({ ...snapshot, lastError: message });
        return {
          content: [{ type: "text", text: message }],
          details: { outputPath: "", written: 0, unanchored: [] },
          isError: true,
        };
      }

      const { anchors: anchored, unanchored } = collectCommentAnchors(snapshot.issues);

      if (anchored.length === 0) {
        const message =
          snapshot.issues.length === 0 ? "还没有审查结论" : "结论里没有可定位的 blockIndex";
        publish({ ...snapshot, lastError: message });
        return {
          content: [{ type: "text", text: message }],
          details: { outputPath: "", written: 0, unanchored },
          isError: true,
        };
      }

      try {
        const result = await writeBidWorkingCopy({
          sourcePath: doc.path,
          outputDirectory: input.outputDirectory,
          comments: anchored,
        });
        if (result.status !== "written") {
          const message = describeWorkingCopyFailure(result) ?? "批注未写入";
          publish({ ...snapshot, lastError: message });
          return {
            content: [{ type: "text", text: message }],
            details: { outputPath: "", written: 0, unanchored },
            isError: true,
          };
        }
        lastWorkingCopy = result.outputPath;
        const skipped = [...result.skipped, ...unanchored];
        const tableNote =
          result.degraded.length > 0
            ? `；其中 ${result.degraded.length} 条落在表格内，已锚定到表格上方的段落并在批注里注明了行列，未精确到单元格`
            : "";
        const note =
          skipped.length > 0
            ? `，另有 ${skipped.length} 条因定位缺失未写入（${skipped.join("、")}）`
            : "";
        return {
          content: [
            {
              type: "text",
              text: `已写入 ${result.written} 条批注到 ${result.outputPath}${tableNote}${note}`,
            },
          ],
          details: {
            outputPath: result.outputPath,
            written: result.written,
            unanchored: skipped,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        publish({ ...snapshot, lastError: message });
        return {
          content: [{ type: "text", text: `写入批注失败：${message}` }],
          details: { outputPath: "", written: 0, unanchored },
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "bid_export_report",
    label: "Export bid review report",
    description: "Export the current review results as a report",
    parameters: Type.Object({
      format: Type.Union([Type.Literal("markdown"), Type.Literal("html")]),
      outputDirectory: Type.Optional(
        Type.String({ description: "报告输出目录；省略则写在标书所在目录" }),
      ),
    }),
    async execute(_id, input) {
      if (!currentLedger) {
        return {
          content: [{ type: "text", text: "还没有台账：请先用 bid_record_findings 记录结论" }],
          details: { outputPath: "", format: input.format, entries: 0 },
          isError: true,
        };
      }
      const document = snapshot.loadedFiles[snapshot.loadedFiles.length - 1];
      const directory =
        input.outputDirectory ?? (document ? resolve(dirname(document.path)) : null);
      if (!directory) {
        return {
          content: [{ type: "text", text: "没有可写报告的目录：请指定 outputDirectory" }],
          details: { outputPath: "", format: input.format, entries: 0 },
          isError: true,
        };
      }
      const result = await writeReviewReport({
        ledger: currentLedger,
        directory,
        format: input.format === "html" ? "html" : "markdown",
      });
      return {
        content: [{ type: "text", text: `已导出 ${result.entries} 条条目到 ${result.outputPath}` }],
        details: result,
      };
    },
  });

  pi.registerCommand("bid-review", {
    description: "Open the bid review panel and start reviewing bid documents",
    handler: async (_args, context) => {
      ctx = context;
    },
  });

  // Both views are hosted the same way and expose the same service, so they
  // share one facet factory. The facet id differs because the host keys a
  // backend facet per view.
  const backendFacet = (id: string) =>
    defineFacet({
      id,
      setup(env) {
        const state = env.replicatedState(snapshot);
        const listener = (next: BidReviewState) => state.replace(BACKGROUND_CONTEXT, next);
        listeners.add(listener);
        env.own(() => {
          listeners.delete(listener);
        });
        env.provide(BidReview, {
          state,
          async loadDocument(input) {
            const doc = await ingestDocument(input.filePath);
            publish({
              ...snapshot,
              loadedFiles: [...snapshot.loadedFiles, doc],
              lastError: null,
            });
            return { id: doc.id, name: doc.name, sections: doc.sections };
          },
          async startReview(input) {
            const reviewId = crypto.randomUUID();
            reviewingBids.clear();
            const briefs: string[] = [];
            for (const fileId of input.fileIds) {
              const doc = snapshot.loadedFiles.find((file) => file.id === fileId);
              const bid = loadedBids.get(fileId);
              if (!doc || !bid) continue;
              reviewingBids.set(fileId, { doc, bid });
              briefs.push(
                buildReviewBrief(
                  doc,
                  bid,
                  readCriteria(doc.path),
                  TEXT_BUDGET,
                  await readDeclaredGoal(),
                  await readPreviousComments(),
                ),
              );
            }
            if (briefs.length === 0) {
              const message = "没有可审查的文档：请先加载标书";
              publish({ ...snapshot, lastError: message });
              throw new Error(message);
            }
            publish({
              ...snapshot,
              reviewStatus: "reviewing",
              progress: 0,
              issues: [],
              summary: null,
              lastError: null,
            });
            // The review itself is the model's job; hand it the brief as a turn.
            await pi.sendUserMessage(briefs.join("\n\n---\n\n"));
            return { reviewId };
          },
          async cancelReview() {
            reviewingBids.clear();
            publish({ ...snapshot, reviewStatus: "idle", progress: 0 });
          },
          async readDocument(input) {
            const bid = loadedBids.get(input.fileId);
            if (!bid) throw new Error("文档尚未加载或已失效");
            return { blocks: bid.blocks };
          },
          async writeComments(input) {
            const doc = input.fileId
              ? snapshot.loadedFiles.find((file) => file.id === input.fileId)
              : snapshot.loadedFiles[snapshot.loadedFiles.length - 1];
            if (!doc) throw new Error("没有已加载的标书");

            const { anchors, unanchored } = collectCommentAnchors(snapshot.issues);
            if (anchors.length === 0) {
              throw new Error(
                snapshot.issues.length === 0 ? "还没有审查结论" : "结论里没有可定位的 blockIndex",
              );
            }
            const result = await writeBidWorkingCopy({
              sourcePath: doc.path,
              comments: anchors,
            });
            if (result.status !== "written") {
              throw new Error(describeWorkingCopyFailure(result) ?? "批注未写入");
            }
            return {
              outputPath: result.outputPath,
              written: result.written,
              skipped: [...result.skipped, ...unanchored],
            };
          },
          async exportReport(input) {
            if (!currentLedger) {
              throw new Error("还没有台账：请先记录审查结论");
            }
            const target = snapshot.loadedFiles[snapshot.loadedFiles.length - 1];
            const directory =
              input.outputDirectory ?? (target ? dirname(resolve(target.path)) : null);
            if (!directory) throw new Error("没有可写报告的目录");
            const written = await writeReviewReport({
              ledger: currentLedger,
              directory,
              format: input.format === "html" ? "html" : "markdown",
            });
            return {
              title: "投标审查报告",
              content: renderMarkdownReport(currentLedger),
              outputPath: written.outputPath,
            };
          },
        });
      },
    });

  registerDesktopView(pi, {
    id: "bid-review",
    title: "Bid Review",
    source: import.meta.url,
    frontend: new URL("./dist/desktop.js", import.meta.url),
    backend: () => backendFacet("bid-workshop.bid-review.backend"),
  });

  registerDesktopView(pi, {
    id: "bid-document",
    title: "Bid Document",
    source: import.meta.url,
    frontend: new URL("./dist/document-desktop.js", import.meta.url),
    backend: () => backendFacet("bid-workshop.bid-document.backend"),
  });
}
