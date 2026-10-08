import { copyFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * Finalising a review: keep the working copy, keep the original, and save a
 * third file that carries the comments and the disposition record.
 *
 * The document's body is not rewritten here — the comments are the record — so
 * the wording says exactly that instead of implying the text was revised.
 */

export const DEFAULT_FINAL_SUFFIX = "-定稿";

/** The sentence a user sees when a review is finalised. */
export const FINALIZE_NOTE = "定稿只包含批注与处置记录，正文未被改写；原稿与工作副本都保留。";

export interface FinalizeRequest {
  /** The working copy the comments were written into. */
  readonly copyPath: string;
  /** Where the final copy goes; defaults to the working copy's own directory. */
  readonly outputDirectory?: string;
  /** `YYYY-MM-DD`; the caller supplies it so the name is reproducible. */
  readonly date?: string;
  readonly suffix?: string;
}

export interface FinalizeResult {
  readonly outputPath: string;
  readonly copiedFrom: string;
}

export function finalFileName(
  copyPath: string,
  date?: string,
  suffix = DEFAULT_FINAL_SUFFIX,
): string {
  const name = basename(copyPath);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : ".docx";
  return `${stem}${suffix}${date ? date : ""}${extension}`;
}

export function finalPath(
  copyPath: string,
  outputDirectory?: string,
  date?: string,
  suffix?: string,
): string {
  return join(outputDirectory ?? dirname(copyPath), finalFileName(copyPath, date, suffix));
}

export async function finalizeBidDocument(request: FinalizeRequest): Promise<FinalizeResult> {
  const source = await stat(request.copyPath).catch(() => null);
  if (!source?.isFile()) {
    throw new Error(`工作副本不存在或不是文件：${request.copyPath}`);
  }
  const outputPath = finalPath(
    request.copyPath,
    request.outputDirectory,
    request.date,
    request.suffix,
  );
  await copyFile(request.copyPath, outputPath);
  return { outputPath, copiedFrom: request.copyPath };
}
