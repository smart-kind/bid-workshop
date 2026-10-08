import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { writeBidComments, type BidCommentAnchor, type BidCommentWriteResult } from "./document";

/** What the workspace's delivery defaults call the copy. */
export const DEFAULT_COMMENT_SUFFIX = "-批注";

/**
 * Why a copy was not produced. The classes are kept apart because they call for
 * different recovery: an unreadable source is a user path problem, a read-only
 * destination is a workspace rule, and an engine failure is a bug to report
 * rather than a condition to retry.
 */
export type WorkingCopyFailure = "unreadable" | "no-permission" | "read-only" | "engine-failure";

export interface WorkingCopyRequest {
  sourcePath: string;
  /** Where the copy goes. The caller resolves it from the workspace's output zone. */
  outputDirectory?: string;
  /** Overrides the workspace's `delivery.outputSuffix`. */
  suffix?: string;
  comments: readonly BidCommentAnchor[];
  /** Set when the destination is already known to be read-only; nothing is attempted. */
  readOnlyReason?: string;
}

export type WorkingCopyResult =
  | ({
      readonly status: "written";
      readonly sourceFingerprint: string;
    } & BidCommentWriteResult)
  | { readonly status: "refused"; readonly reason: "read-only"; readonly message: string }
  | {
      readonly status: "failed";
      readonly reason: WorkingCopyFailure;
      readonly message: string;
    };

/** `投标文件.docx` → `投标文件-批注.docx`, keeping any other extension intact. */
export function workingCopyFileName(sourcePath: string, suffix = DEFAULT_COMMENT_SUFFIX): string {
  const name = basename(sourcePath);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}${suffix}`;
  return `${name.slice(0, dot)}${suffix}${name.slice(dot)}`;
}

export function workingCopyPath(
  sourcePath: string,
  outputDirectory?: string,
  suffix?: string,
): string {
  return join(outputDirectory ?? dirname(sourcePath), workingCopyFileName(sourcePath, suffix));
}

/** Content fingerprint of the source, so a later run can tell it changed. */
export function fingerprintBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function classifyWriteFailure(error: unknown): WorkingCopyFailure {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") return "no-permission";
  if (code === "ENOENT" || code === "EISDIR") return "unreadable";
  const message = error instanceof Error ? error.message : String(error);
  if (/解析|parse|zip|docx/i.test(message)) return "unreadable";
  return "engine-failure";
}

/**
 * Read the source, fingerprint it, and write one copy with the comments in it.
 * The original is never the destination: the copy is a new file next to it, or
 * in the output directory the caller resolved from the workspace profile.
 */
export async function writeBidWorkingCopy(request: WorkingCopyRequest): Promise<WorkingCopyResult> {
  if (request.readOnlyReason) {
    return { status: "refused", reason: "read-only", message: request.readOnlyReason };
  }

  let source: Buffer;
  try {
    source = await readFile(request.sourcePath);
  } catch (error) {
    return {
      status: "failed",
      reason: classifyWriteFailure(error),
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const outputPath = workingCopyPath(request.sourcePath, request.outputDirectory, request.suffix);
  try {
    const written = await writeBidComments({
      sourcePath: request.sourcePath,
      outputPath,
      comments: [...request.comments],
    });
    return { status: "written", sourceFingerprint: fingerprintBytes(source), ...written };
  } catch (error) {
    return {
      status: "failed",
      reason: classifyWriteFailure(error),
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function describeWorkingCopyFailure(result: WorkingCopyResult): string | null {
  if (result.status === "written") return null;
  switch (result.reason) {
    case "read-only":
      return `未写入：目标在只读分区（${result.message}）`;
    case "unreadable":
      return `未写入：原稿无法读取（${result.message}）`;
    case "no-permission":
      return `未写入：没有写入权限（${result.message}）`;
    default:
      return `未写入：文档引擎报错（${result.message}）`;
  }
}
