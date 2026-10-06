import { Type } from 'typebox'
import type { ToolSet } from '../tool/registry.js'
import type { AnyHarnessTool, ToolContext, ToolResult } from '../tool/types.js'

/**
 * Version control tools.
 *
 * The workspace is a git repository, so what a verification run concluded lands
 * as a commit and the history of a bid is inspectable. Nothing here commits on
 * its own: "this is a point worth keeping" is a judgement, and a history full of
 * automatic commits with generated messages is one nobody reads.
 */
export function createVersionToolSet(): ToolSet {
  const tools: AnyHarnessTool[] = [
    {
      name: 'version_status',
      label: '版本状态',
      description:
        'Show the workspace repository state: current branch, HEAD, and every path with uncommitted ' +
        'changes. Check this before committing so the commit message describes what actually changed.',
      parameters: Type.Object({}),
      set: 'version',
      effect: 'query',
      execute: async (ctx: ToolContext): Promise<ToolResult> => {
        try {
          const status = await ctx.vcs.status()
          const lines = [
            `分支 ${status.branch}${status.head ? ` @ ${status.head}` : '（尚无提交）'}`,
            status.clean
              ? '工作区干净，没有未提交的改动。'
              : `未提交改动 ${status.changes.length} 处：`,
            ...status.changes.slice(0, 50),
          ]
          if (status.changes.length > 50) lines.push(`…以及另外 ${status.changes.length - 50} 处`)
          return {
            output: lines.join('\n'),
            summary: status.clean ? '无未提交改动' : `${status.changes.length} 处未提交改动`,
          }
        } catch (error) {
          return { output: errorText(error), isError: true }
        }
      },
    },
    {
      name: 'version_commit',
      label: '提交版本',
      description:
        'Commit every uncommitted change in the workspace with one message. Use it to mark a ' +
        'finished piece of work — after a verification run, say, so its result and the document it ' +
        'judged are one restorable point. A commit with nothing to record is reported, not an error.',
      parameters: Type.Object({
        message: Type.String({
          description:
            'Commit subject, one line. Describe what changed and why, e.g. "核验：技术说明 12 条发现（技能 v3）"',
        }),
      }),
      set: 'version',
      effect: 'workspace',
      execute: async (ctx: ToolContext, params: { message: string }): Promise<ToolResult> => {
        try {
          const result = await ctx.vcs.commit(params.message)
          if (!result.ok) return { output: result.error ?? '提交失败', isError: true }
          if (result.nothingToCommit) {
            return { output: '没有需要提交的改动，仓库已是最新。', summary: '无改动可提交' }
          }
          return {
            output: `已提交 ${result.hash}：${params.message.trim()}`,
            mutated: true,
            summary: `提交 ${result.hash}`,
          }
        } catch (error) {
          return { output: errorText(error), isError: true }
        }
      },
    },
    {
      name: 'version_log',
      label: '提交历史',
      description:
        'List recent commits, newest first. This is how to find out what an earlier state looked ' +
        'like, and which run produced the artefact now on disk.',
      parameters: Type.Object({
        limit: Type.Optional(Type.Number({ description: 'How many commits to list (default 20)' })),
      }),
      set: 'version',
      effect: 'query',
      execute: async (ctx: ToolContext, params: { limit?: number }): Promise<ToolResult> => {
        try {
          const commits = await ctx.vcs.log(params.limit ?? 20)
          if (commits.length === 0) return { output: '（还没有提交）', summary: '无提交历史' }
          return {
            output: commits
              .map((commit) => `${commit.hash}  ${commit.at}  ${commit.subject}`)
              .join('\n'),
            summary: `${commits.length} 条提交`,
          }
        } catch (error) {
          return { output: errorText(error), isError: true }
        }
      },
    },
  ]

  // With version control switched off in the manifest the tools would only ever
  // return errors, so the set withholds itself rather than advertising them.
  return { id: 'version', tools: (ctx: ToolContext) => (ctx.vcs.enabled() ? tools : []) }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
