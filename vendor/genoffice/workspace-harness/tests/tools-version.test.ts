import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isRepo } from '../src/workspace/git.js'
import { WorkspaceStore } from '../src/workspace/store.js'
import { createFakeContext, type FakeContext } from './helpers/fake-context.js'
import { makeHarness, type Harness } from './helpers/tools.js'

/**
 * These tests run against a real `git` in a temp directory: the point of the
 * feature is that the workspace *is* a repository, and a fake git would not
 * catch the failures that matter (a missing identity, an empty change set, a
 * `.gitignore` that swallows the output).
 */

let root: string
let store: WorkspaceStore
let ctx: FakeContext
let h: Harness

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'workspace-harness-version-'))
  store = new WorkspaceStore(join(root, 'workspaces'))
  ctx = createFakeContext(store, '写标书并核验')
  h = makeHarness(store, ctx)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('workspace as a repository', () => {
  it('is a repository from creation, with the initial commit already made', () => {
    expect(isRepo(ctx.workspace.dir)).toBe(true)
  })
})

describe('version tool set', () => {
  it('declares the three tools', () => {
    expect(
      h.tools
        .filter((tool) => tool.set === 'version')
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(['version_commit', 'version_log', 'version_status'])
  })

  it('withholds itself when version control is switched off', () => {
    ctx.workspace.manifest.vcs.enabled = false
    // The set decides at composition time, so rebuild the harness around it.
    const disabled = makeHarness(store, ctx)
    expect(disabled.tools.filter((tool) => tool.set === 'version')).toEqual([])
  })
})

describe('version_status', () => {
  it('reports a clean tree on a fresh workspace and shows changes once it is not', async () => {
    const clean = await h.call('version_status')
    expect(clean.isError).toBeUndefined()
    expect(clean.output).toContain('分支 main')
    expect(clean.output).toContain('工作区干净')

    await h.call('fs_write_text', { path: '产出/说明.md', content: '# 说明\n' })

    const dirty = await h.call('version_status')
    expect(dirty.output).toContain('未提交改动')
    // A brand-new zone is untracked as a whole, so git names the directory.
    expect(dirty.output).toContain('产出/')
    expect(dirty.summary).toContain('未提交改动')
  })
})

describe('version_commit', () => {
  it('commits every pending change and leaves the tree clean', async () => {
    await h.call('fs_write_text', { path: '产出/核验报告.md', content: '# 报告\n' })

    const committed = await h.call('version_commit', { message: '核验：技术说明 12 条发现' })
    expect(committed.isError).toBeUndefined()
    expect(committed.mutated).toBe(true)
    expect(committed.output).toContain('核验：技术说明 12 条发现')

    const status = await h.call('version_status')
    expect(status.output).toContain('工作区干净')
  })

  it('reports a commit with nothing to record instead of failing', async () => {
    const result = await h.call('version_commit', { message: '没有改动' })
    expect(result.isError).toBeUndefined()
    expect(result.output).toContain('没有需要提交的改动')
  })

  it('rejects an empty message', async () => {
    const result = await h.call('version_commit', { message: '   ' })
    expect(result.isError).toBe(true)
  })
})

describe('version_log', () => {
  it('lists the initial commit and everything committed after it, newest first', async () => {
    await h.call('fs_write_text', { path: '产出/a.md', content: 'a' })
    await h.call('version_commit', { message: '第一版' })
    await h.call('fs_write_text', { path: '产出/b.md', content: 'b' })
    await h.call('version_commit', { message: '第二版' })

    const log = await h.call('version_log', { limit: 5 })
    const lines = log.output.split('\n')
    expect(lines[0]).toContain('第二版')
    expect(lines[1]).toContain('第一版')
    expect(log.output).toContain('初始化工作空间')
    expect(log.summary).toBe('3 条提交')
  })
})
