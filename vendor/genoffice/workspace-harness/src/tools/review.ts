import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Type } from 'typebox'
import type { ToolSet } from '../tool/registry.js'
import type { AnyHarnessTool, ToolContext, ToolResult } from '../tool/types.js'
import { addDocument } from '../workspace/documents.js'
import { resolveInside } from '../workspace/paths.js'
import { assertWritable, ZONE_DIRS } from '../workspace/zones.js'
import { describeDocument } from './summary.js'

/**
 * The approval ledger: what a verification run concluded, one record per
 * finding.
 *
 * This is deliberately a *tool* rather than a file the agent writes freehand.
 * The point of the ledger is that a later step can diff it, count it, and act
 * on it field by field — which only holds if every record has the same shape.
 * A model writing markdown would produce something readable and unprocessable;
 * the schema check below is what makes the artefact worth keeping.
 *
 * Keys are English while the values stay Chinese: the ledger is machine-first
 * (it is the thing diffs and counts run against), and only one file needs to
 * know the mapping.
 */

export const REVIEW_SEVERITIES = ['废标', '重大偏离', '扣分', '瑕疵'] as const
export const REVIEW_VERDICTS = ['满足', '部分满足', '不满足', '无法核对'] as const
export const REVIEW_DISPOSITIONS = ['待定', '采纳', '拒绝'] as const

export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number]
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number]
export type ReviewDisposition = (typeof REVIEW_DISPOSITIONS)[number]

/** One finding, as it lands in the ledger. */
export interface ReviewFinding {
  type: 'finding'
  id: string
  severity: ReviewSeverity
  /** Which checklist item produced it, e.g. `A3`. */
  check: string
  /** The requirement this was judged against. */
  basis: string
  /** Where in the document, e.g. `产出/投标文件.docx#块42`. */
  location: string
  quote?: string
  verdict: ReviewVerdict
  problem?: string
  advice?: string
  /** Filled in by the review UI later; a run always writes `待定`. */
  disposition: ReviewDisposition
  disposedBy: string | null
  disposedAt: string | null
}

/** The header line, so a ledger records how it was produced. */
export interface ReviewRunHeader {
  type: 'run'
  runId: string
  at: string
  document: string
  skillId: string | null
  skillVersion: number | null
  model: string | null
  findings: number
}

/** Pointer to the newest ledger, so a reader never has to guess by name. */
export interface ReviewPointer {
  latest: string
  runId: string
  at: string
  document: string
  counts: Record<string, number>
}

export const REVIEW_LATEST_FILE = `${ZONE_DIRS.output}/审批数据.json`

/** `20260927-1412`, matching the report file names the workflow already writes. */
function stamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return [
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
    `${pad(now.getHours())}${pad(now.getMinutes())}`,
  ].join('-')
}

interface FindingInput {
  id: string
  severity: ReviewSeverity
  check: string
  basis: string
  location: string
  quote?: string
  verdict: ReviewVerdict
  problem?: string
  advice?: string
}

const SEVERITY_RANK: Record<ReviewSeverity, number> = {
  废标: 0,
  重大偏离: 1,
  扣分: 2,
  瑕疵: 3,
}

/** Every problem at once, so the model can fix a whole batch in one retry. */
function validate(findings: FindingInput[]): string[] {
  const problems: string[] = []
  if (findings.length === 0) problems.push('findings must not be empty')

  const seen = new Set<string>()
  findings.forEach((finding, index) => {
    const where = `findings[${index}]`
    for (const field of ['id', 'check', 'basis', 'location'] as const) {
      if (typeof finding[field] !== 'string' || finding[field].trim() === '') {
        problems.push(`${where}.${field} must be a non-empty string`)
      }
    }
    if (!REVIEW_SEVERITIES.includes(finding.severity)) {
      problems.push(`${where}.severity must be one of ${REVIEW_SEVERITIES.join(' / ')}`)
    }
    if (!REVIEW_VERDICTS.includes(finding.verdict)) {
      problems.push(`${where}.verdict must be one of ${REVIEW_VERDICTS.join(' / ')}`)
    }
    if (seen.has(finding.id)) problems.push(`${where}.id is a duplicate: ${finding.id}`)
    seen.add(finding.id)
    // A finding that is not satisfied has to say what is wrong with it.
    if (finding.verdict !== '满足' && !finding.problem?.trim()) {
      problems.push(`${where}.problem is required when verdict is "${finding.verdict}"`)
    }
  })

  return problems
}

export function createReviewToolSet(): ToolSet {
  const tools: AnyHarnessTool[] = [
    {
      name: 'review_write_findings',
      label: '写核验结论',
      description: [
        'Record the findings of one verification run as the approval ledger.',
        `Writes ${ZONE_DIRS.output}/审批数据-<时间戳>.jsonl (one record per finding) and points ${REVIEW_LATEST_FILE} at it.`,
        'Pass EVERY finding you concluded, including the ones that passed: a clause checked and satisfied is a record too, otherwise the ledger cannot show coverage.',
        'Each finding needs: id (unique, e.g. "A3-1"), severity (废标/重大偏离/扣分/瑕疵), check (the checklist item, e.g. "A3"), basis (the requirement judged against), location (document path + block, e.g. "产出/投标文件.docx#块42"), verdict (满足/部分满足/不满足/无法核对).',
        'problem is required whenever the verdict is not 满足; quote is the smallest useful excerpt from the document.',
        'Write this BEFORE the human-readable report: the ledger is what later steps read, the report is its rendering.',
      ].join(' '),
      parameters: Type.Object({
        document: Type.String({ description: '被核验的产出文件（工作空间相对路径）' }),
        findings: Type.Array(
          Type.Object({
            id: Type.String({ description: '唯一编号，例如 A3-1' }),
            severity: Type.Union(REVIEW_SEVERITIES.map((value) => Type.Literal(value))),
            check: Type.String({ description: '检查项编号，例如 A3' }),
            basis: Type.String({ description: '判据来源，例如「招标文件 3.2 签字盖章」' }),
            location: Type.String({ description: '位置，例如「产出/投标文件.docx#块42」' }),
            quote: Type.Optional(Type.String({ description: '最小必要的原文摘录' })),
            verdict: Type.Union(REVIEW_VERDICTS.map((value) => Type.Literal(value))),
            problem: Type.Optional(
              Type.String({ description: '问题描述（结论非「满足」时必填）' }),
            ),
            advice: Type.Optional(Type.String({ description: '修改建议' })),
          }),
          { description: '本次核验的全部发现，含通过的条款' },
        ),
        skillId: Type.Optional(Type.String({ description: '所用技能的 id' })),
        skillVersion: Type.Optional(Type.Number({ description: '所用技能的版本号' })),
        model: Type.Optional(Type.String({ description: '执行核验的模型' })),
      }),
      set: 'review',
      effect: 'workspace',
      execute: async (
        ctx: ToolContext,
        params: {
          document: string
          findings: FindingInput[]
          skillId?: string
          skillVersion?: number
          model?: string
        },
        _signal?: AbortSignal,
      ): Promise<ToolResult> => {
        const findings = params.findings ?? []
        const problems = validate(findings)
        if (problems.length > 0) {
          return {
            output: `核验结论未通过校验，未写入任何文件：\n- ${problems.join('\n- ')}`,
            isError: true,
          }
        }

        const now = new Date()
        const runId = `run-${stamp(now)}`
        const relPath = `${ZONE_DIRS.output}/审批数据-${stamp(now)}.jsonl`
        assertWritable(relPath)
        assertWritable(REVIEW_LATEST_FILE)

        const header: ReviewRunHeader = {
          type: 'run',
          runId,
          at: now.toISOString(),
          document: params.document,
          skillId: params.skillId ?? null,
          skillVersion: params.skillVersion ?? null,
          model: params.model ?? null,
          findings: findings.length,
        }

        const records: ReviewFinding[] = findings
          .map((finding) => ({
            type: 'finding' as const,
            id: finding.id,
            severity: finding.severity,
            check: finding.check,
            basis: finding.basis,
            location: finding.location,
            ...(finding.quote ? { quote: finding.quote } : {}),
            verdict: finding.verdict,
            ...(finding.problem ? { problem: finding.problem } : {}),
            ...(finding.advice ? { advice: finding.advice } : {}),
            disposition: '待定' as const,
            disposedBy: null,
            disposedAt: null,
          }))
          // Worst first: the reader works top-down and the serious items must
          // not be buried under cosmetic ones.
          .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])

        const lines = [JSON.stringify(header), ...records.map((record) => JSON.stringify(record))]

        const abs = resolveInside(ctx.workspace.dir, relPath)
        mkdirSync(dirname(abs), { recursive: true })
        writeFileSync(abs, `${lines.join('\n')}\n`, 'utf8')

        const counts: Record<string, number> = {}
        for (const record of records) {
          counts[record.severity] = (counts[record.severity] ?? 0) + 1
        }
        const pointer: ReviewPointer = {
          latest: relPath,
          runId,
          at: header.at,
          document: params.document,
          counts,
        }
        writeFileSync(
          resolveInside(ctx.workspace.dir, REVIEW_LATEST_FILE),
          `${JSON.stringify(pointer, null, 2)}\n`,
          'utf8',
        )

        const entries = [relPath, REVIEW_LATEST_FILE].map(
          (path) =>
            ctx.resolveDocument(path) ??
            addDocument(ctx.workspace, { path, source: { kind: 'new' } }),
        )
        ctx.saveWorkspace()

        const tally = REVIEW_SEVERITIES.filter((severity) => counts[severity])
          .map((severity) => `${severity} ${counts[severity]}`)
          .join(' · ')

        return {
          output: `写入了 ${records.length} 条核验结论到 ${relPath}（${tally || '无发现'}），最新指针已指向本次运行。`,
          mutated: true,
          summary: `核验结论 ${records.length} 条（${tally || '无'}）`,
          postState: { pointer, documents: entries.map((entry) => describeDocument(entry)) },
        }
      },
    },
  ]

  return { id: 'review', tools: () => tools }
}
