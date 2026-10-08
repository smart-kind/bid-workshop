import type { CommentMirrorPlan } from "./comment-mirror";
import type { BidCommentWriter, BidDocumentParser } from "./document";

/** Document engine adapters. Implementation: parser-docx.mjs. */
export declare const docxParser: BidDocumentParser;
export declare const docxCommentWriter: BidCommentWriter;
export declare const docxDispositionMirror: {
  mirror(input: {
    sourcePath: string;
    outputPath: string;
    plan: CommentMirrorPlan;
  }): Promise<{ outputPath: string; mirrored: number; replies: number }>;
};
