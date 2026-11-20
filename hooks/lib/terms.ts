// The rules of one game: what is locked at the summon, what is tracked while
// the agent works, and the ruling. Plain functions; no model, no engine.
import type { FileNet, RulingLine, Terms, ToolRecord } from '../../types'
import { WRAPPERS, chain, classifyCommand, isShellEdit } from './commands'
import { evidenceLine, isCodeFile, isTestFile } from './record'
import { LINE } from './words'

const tidy = (command: string): string => command.replace(/\s+/g, ' ').trim()

/**
 * A command as a person would name it: no `cd` or variables in front, no pipe
 * to `tail` or `head` behind, and nothing about where its output goes
 * (`2>&1`, `> out.txt`): that changes what the referee can read, not which run it is.
 */
export function plainCommand(command: string): string {
  const named = tidy(command)
    .replace(/^cd \S+ && /, '')
    .replace(/^(?:[A-Za-z_]\w*=\S* )+/, '')
    .replace(/ ?\| ?(tail|head)( [^|;&]*)?$/, '')

  // Inside quotes a `>` is text (`-k "a > b"`): such a command is left as it is.
  return /["'][^"']*>[^"']*["']/.test(named) ? named : named.replace(/ ?(?:[0-9]|&)?>>? ?(?:&[0-9]|[^\s|;&]+)/g, '')
}

/** A command reduced for comparing: also without a runner in front, and `npm run test` as `npm test`. */
export function bareCommand(command: string): string {
  return plainCommand(command)
    .replace(WRAPPERS, '')
    .replace(/ 2>&1$/, '')
    .replace(/^(npm|pnpm|yarn|bun) run test\b/, '$1 test')
}

// Flags that make a test run smaller. Some take a value, some stand alone.
const NARROWS_WITH_VALUE = new Set([
  '-k', '-m', '-t', '-g', '-run', '--grep', '--fgrep', '--filter', '--testNamePattern', '--testPathPattern',
  '--testPathPatterns', '--testPathIgnorePatterns', '--deselect', '--ignore', '--ignore-glob', '--exclude',
  '--shard', '--changedSince', '--related', '--findRelatedTests', '--project',
])
const NARROWS_ALONE = new Set([
  '--co', '--collect-only', '--lf', '--last-failed', '--onlyChanged', '--changed', '--onlyFailures',
  '--passWithNoTests', '--listTests', '--list', '--dry-run',
])
// Harmless flags whose next word is their value, not a path.
const TAKES_VALUE = new Set([
  '-n', '--tb', '-W', '-p', '-c', '--config', '--color', '--reporter', '--reporters', '--durations', '--cov',
  '--cov-report', '--junitxml', '--outputFile', '--maxWorkers', '-j', '--jobs', '--timeout', '-timeout',
  '--seed', '--rootdir', '-parallel', '--parallel', '-cpu', '-coverprofile', '--maxfail', '-count',
])
// `pytest tests/` runs everything: the test folder itself is no narrowing.
const TEST_ROOT = /^(\.\/)?(tests?|spec|__tests__)\/?$/

type Shape = { words: string[]; narrows: string[] }

// What a test command asks for: its words (the runner and what it names) and
// the narrowing it carries. Harmless flags fall away, wherever they stand.
function shape(command: string): Shape {
  const tokens = bareCommand(command).split(' ').filter(word => word !== '')
  const out: Shape = { words: [], narrows: [] }

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? ''

    if (!token.startsWith('-')) {
      if (!TEST_ROOT.test(token)) out.words.push(token)
      continue
    }

    const eq = token.indexOf('=')
    const flag = eq === -1 ? token : token.slice(0, eq)
    const glued = eq === -1 ? undefined : token.slice(eq + 1)

    if (NARROWS_ALONE.has(flag)) {
      out.narrows.push(flag)
    } else if (NARROWS_WITH_VALUE.has(flag)) {
      if (glued === undefined) i += 1
      out.narrows.push(`${flag} ${glued ?? tokens[i] ?? ''}`)
    } else if (/^-k\S/.test(token)) {
      out.narrows.push(`-k ${token.slice(2)}`) // pytest -kfoo
    } else if ((TAKES_VALUE.has(flag) && glued === undefined) || /^\d+$/.test(tokens[i + 1] ?? '')) {
      i += 1
    }
  }

  return out
}

/**
 * Is the verdict command one of the commands of this chain? Variables and a
 * runner in front, and flags that do not narrow the run, are harmless wherever
 * they stand; a filter or a path makes it a different run. What stands around
 * it (`cd x &&`, `| tail`, `; echo $?`) does not change which run it is: when
 * that hides the exit code, the record's state comes from the counts (see
 * makeRecord).
 */
export function isVerdictRun(command: string, verdict: string, known: readonly string[] = []): boolean {
  const asked = shape(chain(verdict)[0] ?? '')

  if (asked.words.length === 0) {
    return false
  }

  const plain = (path: string): string => path.replace(/^\.\//, '')
  // `pytest forth_test.py` in a folder whose only test file is forth_test.py
  // runs everything: naming every test file the project has is no narrowing.
  const namesThemAll = (extra: readonly string[]): boolean =>
    known.length > 0 &&
    extra.every(word => known.includes(plain(word))) &&
    known.every(file => extra.some(word => plain(word) === file))

  return chain(command).some(part => {
    const ran = shape(part)
    const startsAlike = asked.words.every((word, i) => ran.words[i] === word)
    const extra = ran.words.slice(asked.words.length)

    return (
      startsAlike &&
      (extra.length === 0 || namesThemAll(extra)) &&
      ran.narrows.every(narrow => asked.narrows.includes(narrow))
    )
  })
}

/** The `test` script of a package.json, when it has a real one. */
export function packageTestScript(text: string | undefined): string | undefined {
  try {
    const script: unknown = (JSON.parse(text ?? '') as { scripts?: { test?: unknown } }).scripts?.test

    return typeof script === 'string' && !script.includes('no test specified') ? script : undefined
  } catch {
    return undefined
  }
}

/**
 * The project's test command, from its config files, or else from the names
 * of its files (the folder itself and its `tests` folder).
 */
export function detectVerdict(
  files: Record<string, string | undefined>,
  names: readonly string[] = [],
): string | undefined {
  // shortcut: npm only; pnpm, yarn and bun projects type /summon <command>
  if (packageTestScript(files['package.json']) !== undefined) return 'npm test'
  if (files['pyproject.toml'] !== undefined || files['pytest.ini'] !== undefined) return 'pytest'
  if (files['Cargo.toml'] !== undefined) return 'cargo test'
  if (files['go.mod'] !== undefined) return 'go test ./...'
  if (/^test:/m.test(files.Makefile ?? '')) return 'make test'
  // A beginner's folder often has test files and no config at all.
  if (names.some(name => /(^|\/)(test_[^/]+|[^/]+_test)\.py$/.test(name))) return 'pytest'
  if (names.some(name => /_test\.go$/.test(name))) return 'go test ./...'

  return undefined
}

// The endings of files that hold tests.
const TEST_SOURCE = /\.(py|[cm]?[jt]sx?|go|rb|java|rs|php|cs|kt|swift)$/

const isCodeEdit = (r: ToolRecord): boolean =>
  (r.kind === 'edit' || r.kind === 'write') && r.state !== 'failed' && isCodeFile(r.target)
const isGatedRun = (r: ToolRecord): boolean => r.kind === 'test' || r.kind === 'build'
const newest = (records: readonly ToolRecord[], is: (r: ToolRecord) => boolean): ToolRecord | undefined =>
  records.findLast(is)

/**
 * Locks a game. `script` is the project's package.json test script: when the
 * verdict is `npm test`, running that script's test command directly
 * (`npx vitest run`) is the same run. `names` are the file names of the
 * project's folder and its test folders, as they are at the summon.
 */
export function summon(
  verdict: string,
  ctx: { id: number; at: number },
  records: readonly ToolRecord[],
  script?: string,
  names: readonly string[] = [],
): Terms {
  const testFiles = names.filter(name => isTestFile(name) && TEST_SOURCE.test(name))
  const lastTest = newest(records, r => r.kind === 'test')
  const startFailed = lastTest?.state === 'failed' ? lastTest.counts?.failed : undefined
  const viaPackage = /^(npm|pnpm|yarn|bun) test$/.test(bareCommand(verdict))
  const also = viaPackage && script !== undefined ? chain(script).map(bareCommand).find(part => classifyCommand(part) === 'test') : undefined

  return {
    id: ctx.id,
    at: ctx.at,
    verdict: tidy(verdict),
    ...(also === undefined ? {} : { also }),
    ...(testFiles.length === 0 ? {} : { testFiles }),
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

const isTheVerdict = (t: Terms, command: string): boolean =>
  isVerdictRun(command, t.verdict, t.testFiles) || (t.also !== undefined && isVerdictRun(command, t.also, t.testFiles))

const NO_NET: FileNet = { asserts: 0, tests: 0, skips: 0, tables: 0, removed: [] }
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
    if (isTheVerdict(t, r.target)) {
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

/**
 * The ruling: four rule lines, then the notes (soft lines that never break
 * the game): checks that went into a table, numbers with no source.
 */
export function rule(t: Terms, fromNowhere: readonly string[]): RulingLine[] {
  const files = Object.entries(t.net)
  // One act, one charge: a file that lost a test is judged by the next rule only.
  // Tests and checks that went into a table (`test.each`, `parametrize`) are not counted as lost.
  const standing = files.filter(([path, net]) => (net.tests >= 0 || net.tables > 0) && !t.deleted.includes(path))
  const removed = standing.find(([, net]) => net.asserts < 0 && net.tables <= 0)
  const moved = standing.find(([, net]) => net.asserts < 0 && net.tables > 0)
  const lostTest = files.find(([, net]) => net.tests < 0 && net.tables <= 0)
  // A skip mark in a test file the agent wrote in this game switches off nothing that was there.
  const skipped = files.find(([path, net]) => net.skips > 0 && !t.made.includes(path))
  const gone = t.deleted[0]

  return [
    verdictLine(t),
    removed ? LINE.checksRemoved(removed[0], -removed[1].asserts) : moved ? LINE.checksInTable() : LINE.checksKept(),
    gone !== undefined
      ? LINE.fileDeleted(gone)
      : lostTest
        ? LINE.testsDeleted(lostTest[0], -lostTest[1].tests)
        : LINE.testsKept(),
    skipped ? LINE.switchedOff(skipped[0], skipped[1].skips) : LINE.noneSwitchedOff(),
    // A table can hide a removed check: the rules cannot tell, so the person is asked to look.
    ...(moved ? [LINE.tableNote(moved[0], -moved[1].asserts, moved[1].tables, moved[1].removed)] : []),
    ...(fromNowhere.length === 0 ? [] : [LINE.noSource(fromNowhere)]),
  ]
}

/** A note never breaks the game. */
export function isKept(lines: readonly RulingLine[]): boolean {
  return lines.every(l => l.pass || l.soft === true)
}
