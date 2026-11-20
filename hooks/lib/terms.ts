// The rules of one game: what is locked at the summon, what is tracked while
// the agent works, and the ruling. Plain functions; no model, no engine.
import type { FileNet, RulingLine, Terms, ToolRecord } from '../../types'
import { evidenceLine, isCodeFile, isTestFile } from './record'
import { LINE } from './words'

const tidy = (command: string): string => command.replace(/\s+/g, ' ').trim()

/**
 * The verdict command itself. A `cd` in front and a pipe to `tail` or `head`
 * behind are allowed; `|| true`, extra arguments and other pipes are not.
 */
export function isVerdictRun(command: string, verdict: string): boolean {
  const bare = tidy(command)
    .replace(/^cd \S+ && /, '')
    .replace(/ ?\| ?(tail|head)( [^|;&]*)?$/, '')
    .replace(/ 2>&1$/, '')

  return bare === tidy(verdict)
}

export function detectVerdict(files: Record<string, string | undefined>): string | undefined {
  const pkg = files['package.json']

  if (pkg !== undefined) {
    try {
      const script: unknown = (JSON.parse(pkg) as { scripts?: { test?: unknown } }).scripts?.test

      // shortcut: npm only; pnpm, yarn and bun projects type /summon <command>
      if (typeof script === 'string' && !script.includes('no test specified')) {
        return 'npm test'
      }
    } catch {
      // not JSON: look at the other files
    }
  }

  if (files['pyproject.toml'] !== undefined || files['pytest.ini'] !== undefined) return 'pytest'
  if (files['Cargo.toml'] !== undefined) return 'cargo test'
  if (files['go.mod'] !== undefined) return 'go test ./...'
  if (/^test:/m.test(files.Makefile ?? '')) return 'make test'

  return undefined
}

const isCodeEdit = (r: ToolRecord): boolean =>
  (r.kind === 'edit' || r.kind === 'write') && r.state !== 'failed' && isCodeFile(r.target)
const isGatedRun = (r: ToolRecord): boolean => r.kind === 'test' || r.kind === 'build'
const newest = (records: readonly ToolRecord[], is: (r: ToolRecord) => boolean): ToolRecord | undefined =>
  records.findLast(is)

export function summon(verdict: string, ctx: { id: number; at: number }, records: readonly ToolRecord[]): Terms {
  const lastTest = newest(records, r => r.kind === 'test')
  const startFailed = lastTest?.state === 'failed' ? lastTest.counts?.failed : undefined

  return {
    id: ctx.id,
    at: ctx.at,
    verdict: tidy(verdict),
    startRecord: records.at(-1)?.id ?? 0,
    state: 'in play',
    ...(startFailed === undefined ? {} : { startFailed }),
    fixes: 0,
    lastCodeEdit: newest(records, isCodeEdit)?.id ?? 0,
    lastGatedRun: newest(records, isGatedRun)?.id ?? 0,
    net: {},
    deleted: [],
  }
}

const NO_NET: FileNet = { asserts: 0, tests: 0, skips: 0, tables: 0, removed: [] }

/** Takes one new record into the game's tally. */
export function track(t: Terms, r: ToolRecord): Terms {
  const next: Terms = { ...t }

  if (isCodeEdit(r)) next.lastCodeEdit = r.id
  if (isGatedRun(r)) next.lastGatedRun = r.id

  if (r.testEdit !== undefined && r.state !== 'failed') {
    const was = t.net[r.target] ?? NO_NET
    const e = r.testEdit
    next.net = {
      ...t.net,
      [r.target]: {
        asserts: was.asserts + e.asserts[1] - e.asserts[0],
        tests: was.tests + e.tests[1] - e.tests[0],
        skips: was.skips + e.skips[1] - e.skips[0],
        tables: was.tables + e.tables[1] - e.tables[0],
        removed: [...was.removed, ...e.lines].slice(-3),
      },
    }
  }

  if (r.tool === 'Bash') {
    if (isVerdictRun(r.target, t.verdict)) {
      next.verdictRun = {
        record: r.id,
        state: r.state,
        line: evidenceLine(r),
        ...(r.counts === undefined ? {} : { failed: r.counts.failed }),
      }
    }

    if (/\brm\s/.test(r.target) && r.state !== 'failed') {
      const gone = r.target.split(/\s+/).filter(isTestFile)
      next.deleted = [...new Set([...t.deleted, ...gone])]
    }
  }

  return next
}

function verdictLine(t: Terms): RulingLine {
  const run = t.verdictRun

  if (run === undefined) return LINE.neverRan(t.verdict)
  if (run.record < t.lastCodeEdit) return LINE.codeChanged(t.verdict, run.record)
  if (run.state === 'unknown') return LINE.noResult(t.verdict, run.record)
  if (run.state === 'clean') return LINE.pass(t.verdict, run.record)

  return run.failed !== undefined && t.startFailed !== undefined && run.failed <= t.startFailed
    ? LINE.stillFail(t.verdict, run.record, run.failed, t.startFailed)
    : LINE.fail(t.verdict, run.record)
}

/** The ruling: four rule lines, and one soft note when a number has no source. */
export function rule(t: Terms, fromNowhere: readonly string[]): RulingLine[] {
  const files = Object.entries(t.net)
  // One act, one charge: a file that lost a test is judged by the next rule only.
  const standing = files.filter(([path, net]) => net.tests >= 0 && !t.deleted.includes(path))
  const removed = standing.find(([, net]) => net.asserts < 0 && net.tables <= 0)
  const moved = standing.find(([, net]) => net.asserts < 0 && net.tables > 0)
  const lostTest = files.find(([, net]) => net.tests < 0)
  const skipped = files.find(([, net]) => net.skips > 0)
  const gone = t.deleted[0]

  return [
    verdictLine(t),
    removed
      ? LINE.checksRemoved(removed[0], -removed[1].asserts)
      : moved
        ? LINE.checksMoved(moved[0], -moved[1].asserts, moved[1].tables)
        : LINE.checksKept(),
    gone !== undefined
      ? LINE.fileDeleted(gone)
      : lostTest
        ? LINE.testsDeleted(lostTest[0], -lostTest[1].tests)
        : LINE.testsKept(),
    skipped ? LINE.switchedOff(skipped[0], skipped[1].skips) : LINE.noneSwitchedOff(),
    ...(fromNowhere.length === 0 ? [] : [LINE.noSource(fromNowhere)]),
  ]
}

/** A note never breaks the game. */
export function isKept(lines: readonly RulingLine[]): boolean {
  return lines.every(l => l.pass || l.soft === true)
}
