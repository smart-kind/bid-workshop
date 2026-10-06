import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { VersionBridge } from '../tool/types.js'
import type { GitCommit, GitOutcome, GitStatus } from './types.js'

/**
 * Local version control, by shelling out to the system `git`.
 *
 * Shelling out rather than adding a git library: it reuses whatever the user
 * already has configured, needs no dependency, and works the same way the user's
 * own `git` command does. The cost is that git has to be installed — so every
 * operation here reports failure instead of throwing, and callers treat a
 * missing git as "version control is off" rather than a broken workspace.
 *
 * Commits carry a fixed author identity on purpose. A user who has never set
 * `user.name` / `user.email` would otherwise make every commit fail with
 * "please tell me who you are", which is a confusing way for an automatic commit
 * to break.
 */

const IDENTITY = {
  GIT_AUTHOR_NAME: 'GenOffice',
  GIT_AUTHOR_EMAIL: 'workspace@genoffice.local',
  GIT_COMMITTER_NAME: 'GenOffice',
  GIT_COMMITTER_EMAIL: 'workspace@genoffice.local',
} as const

/** Unit separator, so a subject containing spaces or colons cannot split fields. */
const FIELD_SEP = '\u001f'

/**
 * Every call goes through here so two decisions are made exactly once:
 * `core.quotePath=false` keeps Chinese paths readable in `status --porcelain`
 * output instead of octal escapes (the whole product is Chinese paths), and
 * `LC_ALL=C` pins git's messages to English so nothing depends on the machine's
 * locale.
 */
function run(dir: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...IDENTITY, LC_ALL: 'C' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function messageOf(error: unknown): string {
  const stderr = (error as { stderr?: unknown })?.stderr
  if (typeof stderr === 'string' && stderr.trim()) return stderr.trim()
  if (Buffer.isBuffer(stderr) && stderr.length > 0) return stderr.toString('utf8').trim()
  return error instanceof Error ? error.message : String(error)
}

/** Is a usable `git` on PATH? A workspace without it simply has no history. */
export function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function isRepo(dir: string): boolean {
  return existsSync(join(dir, '.git'))
}

/**
 * Make `dir` a repository, if it is not one already.
 *
 * Idempotent so it can run on workspace creation and again whenever a workspace
 * is opened — a workspace built before version control existed gains a repo on
 * its next open rather than staying permanently untracked.
 */
export function ensureRepo(dir: string, branch = 'main'): GitOutcome {
  if (isRepo(dir)) return { ok: true }
  try {
    run(dir, ['init', '-b', branch])
    return { ok: true }
  } catch (error) {
    // `-b` needs git ≥ 2.28; fall back to whatever the default branch is.
    try {
      run(dir, ['init'])
      return { ok: true }
    } catch {
      return { ok: false, error: messageOf(error) }
    }
  }
}

export function status(dir: string): GitStatus {
  try {
    const branch = run(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
    let head: string | null = null
    try {
      head = run(dir, ['rev-parse', '--short', 'HEAD']).trim()
    } catch {
      // No commits yet: HEAD does not resolve, which is not an error here.
      head = null
    }
    const changes = run(dir, ['status', '--porcelain'])
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
    return { branch, head, clean: changes.length === 0, changes }
  } catch (error) {
    throw new Error(messageOf(error), { cause: error })
  }
}

/** Stage everything and commit. An empty change set is reported, not thrown. */
export function commitAll(dir: string, message: string): GitOutcome {
  const subject = message.trim()
  if (!subject) return { ok: false, error: 'commit message must not be empty' }
  try {
    run(dir, ['add', '-A'])
    // Ask git whether anything is staged rather than pattern-matching the commit
    // failure: "nothing to commit" is the one message git translates.
    if (run(dir, ['status', '--porcelain']).trim() === '') {
      return { ok: true, nothingToCommit: true }
    }
    try {
      run(dir, ['commit', '-m', subject])
    } catch (error) {
      return { ok: false, error: messageOf(error) }
    }
    return { ok: true, hash: run(dir, ['rev-parse', '--short', 'HEAD']).trim() }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

export function log(dir: string, limit = 20): GitCommit[] {
  try {
    const out = run(dir, ['log', `-n${limit}`, `--pretty=format:%h${FIELD_SEP}%s${FIELD_SEP}%cI`])
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash = '', subject = '', at = ''] = line.split(FIELD_SEP)
        return { hash, subject, at }
      })
  } catch {
    // An empty repository has no log; that is an empty history, not an error.
    return []
  }
}

/** The `VersionBridge` the tools call, resolved against the open workspace. */
export function createGitVersionBridge(
  dir: () => string | null,
  enabled: () => boolean,
): VersionBridge {
  const require = (): string => {
    const root = dir()
    if (!root) throw new Error('no workspace is open')
    if (!isRepo(root)) throw new Error('version control is not initialised for this workspace')
    return root
  }

  return {
    enabled,
    status: async () => status(require()),
    commit: async (message: string) => commitAll(require(), message),
    log: async (limit?: number) => log(require(), limit ?? 20),
  }
}
