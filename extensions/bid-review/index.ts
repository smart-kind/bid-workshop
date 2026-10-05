import { defineFacet } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerDesktopView } from "@bid-workshop/extension-ui";
import { BidReview, type BidReviewState } from "./contract";

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

export default function bidReview(pi: ExtensionAPI) {
  let ctx: ExtensionContext | null = null;
  let snapshot = initialState();
  const listeners = new Set<(state: BidReviewState) => void>();
  const publish = (next: BidReviewState) => {
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
  };

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
    description: "Load a bid document (.docx) for review",
    parameters: Type.Object({
      filePath: Type.String({ minLength: 1, maxLength: 2048, description: "Path to the bid document file" }),
    }),
    async execute(_id, input) {
      // TODO: implement actual document loading via genoffice
      const doc = {
        id: crypto.randomUUID(),
        name: input.filePath.split("/").pop() || input.filePath,
        path: input.filePath,
        size: 0,
        loadedAt: Date.now(),
        sections: [],
      };
      publish({
        ...snapshot,
        loadedFiles: [...snapshot.loadedFiles, doc],
        lastError: null,
      });
      return {
        content: [{ type: "text", text: `Loaded: ${doc.name}` }],
        details: { id: doc.id, sections: doc.sections.length },
      };
    },
  });

  pi.registerTool({
    name: "bid_start_review",
    label: "Start bid review",
    description: "Start AI-powered review of loaded bid documents",
    parameters: Type.Object({
      fileIds: Type.Array(Type.String(), { minItems: 1, maxItems: 20 }),
    }),
    async execute(_id, input) {
      publish({ ...snapshot, reviewStatus: "reviewing", progress: 0, lastError: null });
      // TODO: implement actual review logic
      return {
        content: [{ type: "text", text: `Bid review started for ${input.fileIds.length} document(s)` }],
        details: { fileIds: input.fileIds },
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
      // TODO: implement actual report export
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
      // TODO: activate bid-review tab
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
          env.own(() => { listeners.delete(listener); });
          env.provide(BidReview, {
            state,
            async loadDocument(input) {
              const doc = {
                id: crypto.randomUUID(),
                name: input.filePath.split("/").pop() || input.filePath,
                path: input.filePath,
                size: 0,
                loadedAt: Date.now(),
                sections: [],
              };
              publish({
                ...snapshot,
                loadedFiles: [...snapshot.loadedFiles, doc],
                lastError: null,
              });
              return { id: doc.id, name: doc.name, sections: doc.sections };
            },
            async startReview(input) {
              publish({ ...snapshot, reviewStatus: "reviewing", progress: 0 });
              return { reviewId: crypto.randomUUID() };
            },
            async cancelReview() {
              publish({ ...snapshot, reviewStatus: "idle" });
            },
            async exportReport(input) {
              return { title: "Bid Review Report", content: "", outputPath: "/tmp/report" };
            },
          });
        },
      }),
  });
}
