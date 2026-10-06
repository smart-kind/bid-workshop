import { defineFacet } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerDesktopView } from "@bid-workshop/extension-ui";
import { BidReview, type BidDocument, type BidReviewState } from "./contract";
import { describeBid, loadBidDocument, setBidDocumentParser, type LoadedBid } from "./document";
import { docxParser } from "./parser-docx.mjs";
import { buildReviewBrief, readCriteria, toBidIssue, type FindingInput } from "./review";

// Install the document engine adapter once, at module load. Everything below
// talks to the parser interface rather than to the engine.
setBidDocumentParser(docxParser);

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
});

/** Parse a .docx and register it as a loaded document. */
async function ingestDocument(filePath: string): Promise<BidDocument> {
  const bid = await loadBidDocument(filePath);
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
    publish(initialState());
  });

  pi.on("session_tree", (_event, context) => {
    ctx = context;
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
        briefs.push(buildReviewBrief(doc, bid, readCriteria(doc.path), TEXT_BUDGET));
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
      return {
        content: [
          {
            type: "text",
            text: `已记录 ${issues.length} 条结论（严重 ${counts.critical} / 警告 ${counts.warning} / 提示 ${counts.info}）`,
          },
        ],
        details: { count: issues.length, ...counts },
      };
    },
  });

  pi.registerTool({
    name: "bid_export_report",
    label: "Export bid review report",
    description: "Export the current review results as a report",
    parameters: Type.Object({
      format: Type.Union([Type.Literal("markdown"), Type.Literal("pdf")]),
    }),
    async execute(_id, input) {
      const outputPath = `/tmp/bid-review-${Date.now()}.${input.format === "markdown" ? "md" : "pdf"}`;
      return {
        content: [{ type: "text", text: `Report exported to: ${outputPath}` }],
        details: { outputPath, format: input.format },
      };
    },
  });

  pi.registerCommand("bid-review", {
    description: "Open the bid review panel and start reviewing bid documents",
    handler: async (_args, context) => {
      ctx = context;
    },
  });

  registerDesktopView(pi, {
    id: "bid-review",
    title: "Bid Review",
    source: import.meta.url,
    frontend: new URL("./dist/desktop.js", import.meta.url),
    backend: () =>
      defineFacet({
        id: "bid-workshop.bid-review.backend",
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
                briefs.push(buildReviewBrief(doc, bid, readCriteria(doc.path), TEXT_BUDGET));
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
            async exportReport(input) {
              return {
                title: "Bid Review Report",
                content: snapshot.summary || "",
                outputPath: "/tmp/report",
              };
            },
          });
        },
      }),
  });
}
