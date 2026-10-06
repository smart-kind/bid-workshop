import { existsSync, mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ReviewFinding, ReviewPointer, ReviewRunHeader } from '../src/tools/review.js'
import { REVIEW_LATEST_FILE } from '../src/tools/review.js'
import { WorkspaceStore } from '../src/workspace/store.js'
import { createFakeContext, type FakeContext } from './helpers/fake-context.js'
import { makeHarness, type Harness } from './helpers/tools.js'

let root: string
let store: WorkspaceStore
let ctx: FakeContext
let h: Harness

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'workspace-harness-review-'))
  store = new WorkspaceStore(join(root, 'workspaces'))
  ctx = createFakeContext(store, '写标书并核验')
  h = makeHarness(store, ctx)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function finding(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'A1-1',
    severity: '废标',
    check: 'A1',
    basis: '招标文件 3.1 投标文件组成',
    location: '产出/投标文件.docx#块1',
    verdict: '不满足',
    problem: '缺少投标函',
    ...overrides,
  }
}

function readPointer(): ReviewPointer {
  return JSON.parse(
    readFileSync(join(ctx.workspace.dir, REVIEW_LATEST_FILE), 'utf8'),
  ) as ReviewPointer
}

function readLedger(pointer: ReviewPointer): {
  header: ReviewRunHeader
  findings: ReviewFinding[]
} {
  const lines = readFileSync(join(ctx.workspace.dir, pointer.latest), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ReviewRunHeader | ReviewFinding)
  const [header, ...findings] = lines as [ReviewRunHeader, ...ReviewFinding[]]
  return { header, findings }
}

describe('review tool set', () => {
  it('declares one workspace-mutating tool', () => {
    expect(h.tools.filter((tool) => tool.set === 'review').map((tool) => tool.name)).toEqual([
      'review_write_findings',
    ])
    expect(h.effectOf('review_write_findings')).toBe('workspace')
  })
})

describe('review_write_findings', () => {
  it('writes the ledger and points the latest pointer at it', async () => {
    const result = await h.call('review_write_findings', {
      document: '产出/投标文件.docx',
      skillId: 'bid-review',
      skillVersion: 3,
      model: 'qwen3.7-plus',
      findings: [
        finding(),
        finding({
          id: 'B1-1',
          severity: '扣分',
          check: 'B1',
          verdict: '满足',
          problem: undefined,
        }),
      ],
    })

    expect(result.isError).toBeUndefined()
    expect(result.mutated).toBe(true)
    expect(result.output).toContain('2 条')

    const pointer = readPointer()
    expect(pointer.latest).toMatch(/^产出\/审批数据-\d{8}-\d{4}\.jsonl$/)
    expect(pointer.document).toBe('产出/投标文件.docx')
    expect(pointer.counts).toEqual({ 废标: 1, 扣分: 1 })

    const { header, findings } = readLedger(pointer)
    expect(header).toMatchObject({
      type: 'run',
      document: '产出/投标文件.docx',
      skillId: 'bid-review',
      skillVersion: 3,
      model: 'qwen3.7-plus',
      findings: 2,
    })
    expect(findings).toHaveLength(2)
    // Worst first, so a reader working top-down meets 废标 before 扣分.
    expect(findings[0]!.severity).toBe('废标')
    expect(findings[1]!.severity).toBe('扣分')
  })

  it('defaults every finding to 待定 so a later UI can fill the disposition in', async () => {
    await h.call('review_write_findings', {
      document: '产出/投标文件.docx',
      findings: [finding()],
    })
    const { findings } = readLedger(readPointer())
    expect(findings[0]).toMatchObject({ disposition: '待定', disposedBy: null, disposedAt: null })
  })

  it('records satisfied clauses too, so coverage is visible', async () => {
    await h.call('review_write_findings', {
      document: '产出/投标文件.docx',
      findings: [
        finding({ id: 'A1-1', severity: '废标', verdict: '满足', problem: undefined }),
        finding({ id: 'A2-1', severity: '扣分', check: 'A2', verdict: '满足', problem: undefined }),
      ],
    })
    const { findings } = readLedger(readPointer())
    expect(findings.map((f) => f.verdict)).toEqual(['满足', '满足'])
  })

  it('refuses an empty run and writes nothing', async () => {
    const result = await h.call('review_write_findings', {
      document: '产出/投标文件.docx',
      findings: [],
    })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('findings must not be empty')
    expect(existsSync(join(ctx.workspace.dir, REVIEW_LATEST_FILE))).toBe(false)
  })

  it('reports every schema problem at once, naming the offending field', async () => {
    const result = await h.call('review_write_findings', {
      document: '产出/投标文件.docx',
      findings: [
        finding({ id: '', check: '', verdict: '不满足' }),
        finding({ id: 'A1-1', severity: '严重', verdict: '大概满足' }),
        finding({ id: 'A1-1', verdict: '部分满足', problem: undefined }),
      ],
    })

    expect(result.isError).toBe(true)
    const output = result.output
    expect(output).toContain('findings[0].id must be a non-empty string')
    expect(output).toContain('findings[0].check must be a non-empty string')
    expect(output).toContain('findings[1].severity must be one of')
    expect(output).toContain('findings[1].verdict must be one of')
    expect(output).toContain('duplicate')
    expect(output).toContain('findings[2].problem is required when verdict is "部分满足"')
    expect(readdirSync(join(ctx.workspace.dir, '产出'))).toHaveLength(0)
  })

  it('requires a problem whenever the verdict is not 满足', async () => {
    for (const verdict of ['部分满足', '不满足', '无法核对']) {
      const result = await h.call('review_write_findings', {
        document: '产出/投标文件.docx',
        findings: [finding({ verdict, problem: undefined })],
      })
      expect(result.isError, verdict).toBe(true)
    }
  })

  it('registers the ledger as a document so it is tracked like any other output', async () => {
    await h.call('review_write_findings', {
      document: '产出/投标文件.docx',
      findings: [finding()],
    })
    const paths = ctx.workspace.manifest.documents.map((doc) => doc.path)
    expect(paths).toContain(REVIEW_LATEST_FILE)
    expect(paths.some((path) => /^产出\/审批数据-\d{8}-\d{4}\.jsonl$/.test(path))).toBe(true)
  })
})
