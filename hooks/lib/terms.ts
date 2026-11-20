// The rules of one game: what is locked at the summon, what is tracked while
// the agent works, and the ruling. Plain functions; no model, no engine.
import type { FileNet, RulingLine, Terms, ToolRecord } from '../../types'
import { chain, isShellEdit } from './commands'
import { evidenceLine, isCodeFile, isTestFile } from './record'
import { LINE } from './words'

const tidy = (command: string): string => command.replace(/\s+/g, ' ').trim()

// Flags that make a test run smaller. A run with one of them is not the verdict run.
const NARROWS =
  /^(-k|-m|-t|-o|-run|--grep|--testNamePattern|--testPathPattern|--filter|--only|--onlyChanged|--changed|--lf|--last-failed|--shard|--related)(=|$)/

/**
 * Is the verdict command one of the commands of this chain? Variables in
 * front and flags that do not narrow the run are harmless; a filter or a path
 * makes it a different run. What stands around it (`cd x &&`, `| tail`,
 * `; echo $?`, `|| true`) does not change which run it is: when that hides the
 * exit code, the record's state comes from the counts (see makeRecord).
 */
export function isVerdictRun(command: string, verdict: string): boolean {
  const asked = bareCommand(chain(verdict)[0] ?? '').split(' ')

  return chain(command).some(part => {
    const ran = bareCommand(part).split(' ')

    if (!asked.every((word, i) => ran[i] === word)) {
      return false
    }

    return ran.slice(asked.length).every((word, i, extra) => {
      const isFlag = word.startsWith('-') && !NARROWS.test(word)
      const isValueOfFlag = /^\d+$/.test(word) && (extra[i - 1] ?? '').startsWith('-')

      return isFlag || isValueOfFlag
    })
  })
}

/**
 * A command in its plain form: no `cd` or variables in front, no pipe to
 * `tail` or `head` behind, and `python -m pytest` and `npm run test` by their
 * short names.
 */
export function bareCommand(command: string): string {
  return tidy(command)
    .replace(/^cd \S+ && /, '')
    .replace(/^(?:[A-Za-z_]\w*=\S* )+/, '')
    .replace(/ ?\| ?(tail|head)( [^|;&]*)?$/, '')
    .replace(/ 2>&1$/, '')
    .replace(/^python3? -m pytest\b/, 'pytest')
    .replace(/^(npm|pnpm|yarn|bun) run test\b/, '$1 test')
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
    made: [],
  }
}

const NO_NET: FileNet = { asserts: 0, tests: 0, skips: 0, tables: 0, removed: [] }

const TEST_SOURCE = /\.(py|[cm]?[jt]sx?|go|rb|java|rs|php|cs|kt|swift)$/
const TEST_FOLDER = /(^|\/)(tests?|__tests__|spec)$/

// What an `rm` takes away from the tests: a test file, or a whole test folder.
const removedTests = (command: string): string[] =>
  command
    .split(/\s+/)
    .map(word => word.replace(/\/$/, ''))
    .filter(word => (isTestFile(word) && TEST_SOURCE.test(word)) || TEST_FOLDER.test(word))

/** Takes one new record into the game's tally. */
export function track(t: Terms, r: ToolRecord): Terms {
  const next: Terms = { ...t }
  const isOk = r.state !== 'failed'

  // Tool calls that ran side by side can arrive out of order: ids only move forward.
  if (isCodeEdit(r) || (r.tool === 'Bash' && isOk && isShellEdit(r.target))) {
    next.lastCodeEdit = Math.max(t.lastCodeEdit, r.id)
  }
  if (isGatedRun(r)) next.lastGatedRun = Math.max(t.lastGatedRun, r.id)

  // A file that is written again is back.
  if ((r.kind === 'edit' || r.kind === 'write') && isOk && t.deleted.includes(r.target)) {
    next.deleted = t.deleted.filter(path => path !== r.target)
  }

  if (r.testEdit !== undefined && isOk) {
    const was = t.net[r.target] ?? NO_NET
    const e = r.testEdit

    if (r.kind === 'write' && t.net[r.target] === undefined && e.asserts[0] === 0 && e.tests[0] === 0) {
      next.made = [...t.made, r.target]
    }

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
      if (t.verdictRun === undefined || r.id > t.verdictRun.record) {
        next.verdictRun = {
          record: r.id,
          state: r.state,
          line: evidenceLine(r),
          ...(r.counts === undefined ? {} : { failed: r.counts.failed }),
        }
      }
    } else if (r.kind === 'test' && (t.otherRun === undefined || r.id > t.otherRun.record)) {
      next.otherRun = { record: r.id, command: r.target.slice(0, 80) }
    }

    if (/\brm\s/.test(r.target) && isOk) {
      const gone = removedTests(r.target)
      // A test file the agent made in this game may be removed again.
      const own = gone.filter(path => next.made.includes(path))
      next.made = next.made.filter(path => !own.includes(path))
      next.net = Object.fromEntries(Object.entries(next.net).filter(([path]) => !own.includes(path)))
      next.deleted = [...new Set([...next.deleted, ...gone.filter(path => !own.includes(path))])]
    }
  }

  return next
}

function verdictLine(t: Terms): RulingLine {
  const run = t.verdictRun

  if (run === undefined) {
    return t.otherRun === undefined
      ? LINE.neverRan(t.verdict)
      : LINE.otherWay(t.verdict, t.otherRun.command, t.otherRun.record)
  }
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
  // Tests and checks that went into a table (`test.each`, `parametrize`) are not lost.
  const standing = files.filter(([path, net]) => (net.tests >= 0 || net.tables > 0) && !t.deleted.includes(path))
  const removed = standing.find(([, net]) => net.asserts < 0 && net.tables <= 0)
  const moved = standing.find(([, net]) => net.asserts < 0 && net.tables > 0)
  const lostTest = files.find(([, net]) => net.tests < 0 && net.tables <= 0)
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
