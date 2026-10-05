import { defineService, type Context, type ReplicatedState } from "@earendil-works/chord";

export interface BidDocument {
  id: string;
  name: string;
  path: string;
  size: number;
  loadedAt: number;
  sections: string[];
}

export interface BidIssue {
  id: string;
  severity: "critical" | "warning" | "info";
  category: string; // "qualification" | "pricing" | "technical" | "legal" | "format"
  title: string;
  description: string;
  location?: { section?: string; page?: number };
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

export interface BidReviewService {
  state: ReplicatedState<BidReviewState>;
  loadDocument(input: { filePath: string }, context: Context): Promise<{ id: string; name: string; sections: string[] }>;
  startReview(input: { fileIds: string[] }, context: Context): Promise<{ reviewId: string }>;
  cancelReview(input: Record<string, never>, context: Context): Promise<void>;
  exportReport(input: { format: "markdown" | "pdf" }, context: Context): Promise<ReportDraft>;
}

export const BidReview = defineService<BidReviewService>("bid-workshop.bid-review.v1");
