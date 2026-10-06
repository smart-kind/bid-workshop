import { defineService, type Context, type ReplicatedState } from "@earendil-works/chord";

export interface BidDocument {
  id: string;
  name: string;
  path: string;
  size: number;
  loadedAt: number;
  /** heading titles, in document order */
  sections: string[];
  blockCount: number;
  tableCount: number;
  charCount: number;
}

export interface BidIssue {
  id: string;
  severity: "critical" | "warning" | "info";
  category: string; // "qualification" | "pricing" | "technical" | "legal" | "format"
  title: string;
  description: string;
  /** Where the problem is. blockIndex points at a block in the loaded document
   *  so a later step can anchor a Word comment there. */
  location?: { section?: string; blockIndex?: number; page?: number; quote?: string };
  /** Which requirement the finding is judged against. */
  basis?: string;
  suggestion?: string;
}

export type BidReviewStatus = "idle" | "reviewing" | "done" | "error";

export interface BidReviewState {
  loadedFiles: BidDocument[];
  reviewStatus: BidReviewStatus;
  issues: BidIssue[];
  summary: string | null;
  progress: number;
  lastError: string | null;
}

export interface ReportDraft {
  title: string;
  content: string;
  outputPath: string;
}

/** One paragraph of a loaded document, as the document view renders it. */
export interface BidBodyBlock {
  index: number;
  type: string;
  level: number;
  text: string;
}

export interface BidWrittenComments {
  outputPath: string;
  written: number;
  skipped: string[];
}

export interface BidReviewService {
  state: ReplicatedState<BidReviewState>;
  loadDocument(
    input: { filePath: string },
    context: Context,
  ): Promise<{ id: string; name: string; sections: string[] }>;
  startReview(input: { fileIds: string[] }, context: Context): Promise<{ reviewId: string }>;
  cancelReview(input: Record<string, never>, context: Context): Promise<void>;
  /** The loaded document's paragraphs, so a view can show the document itself. */
  readDocument(input: { fileId: string }, context: Context): Promise<{ blocks: BidBodyBlock[] }>;
  /** Write the recorded findings into a copy of the document as Word comments. */
  writeComments(input: { fileId?: string }, context: Context): Promise<BidWrittenComments>;
  exportReport(input: { format: "markdown" | "pdf" }, context: Context): Promise<ReportDraft>;
}

export const BidReview = defineService<BidReviewService>("bid-workshop.bid-review.v1");
