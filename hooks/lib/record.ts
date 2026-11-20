// The recorder's rules: what one tool call was, and how it ended.
// Plain functions only. Nothing here talks to the engine.
import type { CommandKind, FileCounts, TestEdit, ToolRecord } from '../../types'
import {
  CODE_FILE,
  classifyCommand,
  countsAreItsOwn,
  isMasked,
  runsAfterAnother,
  runsBeforeAnother,
  sharesOutput,
  words,
} from './commands'

export { classifyCommand, isShellEdit } from './commands'

const OUTPUT_KEPT = 2000
const NUMBERS_KEPT = 150
const LINE_KEPT = 160

const count = (text: string, pattern: RegExp): number => [...text.matchAll(pattern)].length

const num = (found: RegExpMatchArray | null | undefined): number =>
  found?.[1] === undefined ? 0 : Number(found[1])

type Counts = { passed: number; failed: number }

// Every summary a runner printed, by the shape of that runner's own summary
// line. A chained command (`git log`, `wc`) cannot look like one by accident.
function summaries(output: string): Counts[] {
  const found: Counts[] = []
  const add = (passed: number, failed: number) => found.push({ passed, failed })

  // pytest: "3 failed, 31 passed in 2.10s"
  for (const m of output.matchAll(/(\d+ [a-z]+(?:, \d+ [a-z]+)*) in [\d.]+s/g)) {
    const line = m[1] ?? ''
    add(num(line.match(/(\d+) passed/)), num(line.match(/(\d+) failed/)) + num(line.match(/(\d+) errors?/)))
  }
  // jest and vitest: a line that starts with "Tests". A test file that could not
  // be loaded fails the run with no failed test: it stands only in the line
  // above ("Test Files  1 failed", "Test Suites: 1 failed"). So does a stray
  // error in vitest ("Errors  1 error").
  const files = num(output.match(/^\s*Test (?:Files|Suites):?\s.*?(\d+) failed/m))
  const stray = num(output.match(/^\s*Errors\s+(\d+) errors?\b/m))
  for (const m of output.matchAll(/^\s*Tests:?\s+(.*)$/gm)) {
    add(num((m[1] ?? '').match(/(\d+) passed/)), Math.max(num((m[1] ?? '').match(/(\d+) failed/)), files, stray))
  }
  // cargo: "test result: FAILED. 31 passed; 3 failed"
  for (const m of output.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed/g)) add(Number(m[1]), Number(m[2]))
  // unittest: "Ran 34 tests in 0.5s" then "FAILED (failures=3)" or "OK"
  for (const m of output.matchAll(/Ran (\d+) tests? in/g)) {
    const bad = output.match(/FAILED \(([^)]*)\)/)?.[1] ?? ''
    const failed = num(bad.match(/failures=(\d+)/)) + num(bad.match(/errors=(\d+)/))
    add(Number(m[1]) - failed, failed)
  }
  // mocha: the counts stand at the start of their own lines
  for (const m of output.matchAll(/^\s*(\d+) passing\b/gm)) add(Number(m[1]), num(output.match(/^\s*(\d+) failing\b/m)))
  // node --test: "ℹ pass 2" and "ℹ fail 0"; as TAP (Node 20 and 22, when no terminal reads it): "# pass 2"
  for (const m of output.matchAll(/^[ℹ#] pass (\d+)/gm)) add(Number(m[1]), num(output.match(/^[ℹ#] fail (\d+)/m)))
  // go test prints no counts: one `ok` line per passing package (`ok  pkg  0.012s`), `FAIL` lines for the rest
  const ok = count(output, /^ok\s+\S+\s+(?:[\d.]+s|\(cached\))/gm)
  const bad = count(output, /^(?:--- FAIL|FAIL)\b/gm)
  if (ok + bad > 0) add(ok, bad)

  return found
}

// Of several summaries, the worst counts.
const worst = (found: readonly Counts[]): Counts | undefined =>
  found.length === 0
    ? undefined
    : { passed: Math.max(...found.map(c => c.passed)), failed: Math.max(...found.map(c => c.failed)) }

/** The pass and fail counts of a test run. Of several summaries, the worst counts. */
export function parseCounts(output: string): Counts | undefined {
  return worst(summaries(output))
}

const TEST_FILE =
  /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go|rb)$|Tests?\.java$|_spec\.rb$/
/** The endings of files that hold tests. */
export const TEST_SOURCE = /\.(py|[cm]?[jt]sx?|go|rb|java|rs|php|cs|kt|swift)$/
const TEST_FOLDER = /(^|\/)(tests?|__tests__|spec)$/

export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path)
}

/**
 * A file of the project is named by its path there. A folder above the project
 * (`~/tests/calc`) must not make its files test files, and a ruling must not
 * show where the person keeps the project.
 */
export const inside = (root: string, path: string): string =>
  root !== '' && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path

// A path as it is read from a folder, with `.` and `..` resolved; an absolute path stands by itself.
function from(folder: string, path: string): string {
  const whole = path.startsWith('/') || folder === '' ? path : `${folder}/${path}`
  const parts: string[] = []

  for (const part of whole.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '' && part !== '.') parts.push(part)
  }

  return `${whole.startsWith('/') ? '/' : ''}${parts.join('/')}`
}

// What may stand in front of `rm` or `cd`.
const IN_FRONT = /^(?:sudo|command|exec|time|env|nohup|[A-Za-z_]\w*=.*)$/
// A path the referee cannot place: it starts at the home folder, or holds a variable.
const NO_PLACE = /^~|[$`]/

/**
 * What the `rm` commands of a shell command take away from the tests: a test
 * file or a whole test folder, by its path inside the project. Only the words
 * of an `rm` count (`rm -rf dist && npm test` removes no `test`). A short path
 * is read from where the shell stands, and a `cd` in the command moves that.
 * A path outside the project, or one the referee cannot place (`$TMP/tests`,
 * `~/x`), is not the project's.
 */
export function removedTests(command: string, root = '', stood = ''): string[] {
  // Where the shell stands; undefined after a `cd` to a place the referee cannot follow.
  let here: string | undefined = root === '' || stood === '' ? root : stood
  const gone: string[] = []

  for (const step of words(command)) {
    const [name, ...args] = step.slice(Math.max(0, step.findIndex(word => !IN_FRONT.test(word))))

    if (name === 'cd') {
      const to = args[0] ?? '~'

      here = NO_PLACE.test(to) || to === '-' || (here === undefined && !to.startsWith('/')) ? undefined : from(here ?? '', to)
    }

    const named = name === 'rm' ? args : name === 'git' && args[0] === 'rm' ? args.slice(1) : []

    for (const arg of named) {
      if (arg.startsWith('-') || NO_PLACE.test(arg) || (here === undefined && !arg.startsWith('/'))) continue

      const path = inside(root, from(here ?? '', arg))
      const isOutside = root !== '' && path.startsWith('/')

      if (!isOutside && ((isTestFile(path) && TEST_SOURCE.test(path)) || TEST_FOLDER.test(path))) gone.push(path)
    }
  }

  return gone
}

/** Source code only: a changelog, docs, config and data are not code. */
export function isCodeFile(path: string): boolean {
  return CODE_FILE.test(path)
}

const ASSERTS = /\bassert\b|\bexpect\(|\bassert_(eq|ne)!|\bassert[A-Z]\w*|\.should\b/g
// `(?<![.\w])` keeps out a method of the same name: `/re/.test(x)`, `model.fit(X)`.
const TESTS =
  /\bdef test_\w+|(?<![.\w])[xf]?it(\.\w+)*\s*\(|(?<![.\w])test(\.\w+)*\s*\(|\bfunc Test\w*|#\[test\]|@Test\b/g
const SKIPS =
  /\.skip\s*\(|(?<![.\w])xit\s*\(|(?<![.\w])xdescribe\s*\(|@pytest\.mark\.skip(?!if)|@unittest\.skip(?!If|Unless)|\bt\.Skip\(|#\[ignore\]|@Disabled\b|\.only\s*\(|(?<![.\w])fit\s*\(|(?<![.\w])fdescribe\s*\(/g
const TABLES = /\b(test|it|describe)\.each\b|@pytest\.mark\.parametrize|#\[rstest\]|@ParameterizedTest\b/g


// A line that is commented out is not code: a test turned into a comment is gone.
// (`#[` is a Rust attribute and `#!` a first line, not comments.)
const code = (text: string): string =>
  text
    .split('\n')
    .filter(line => !/^\s*(\/\/|#(?![[!]))/.test(line))
    .join('\n')

export function measureTestEdit(oldRaw: string, newRaw: string): TestEdit {
  const oldText = code(oldRaw)
  const newText = code(newRaw)
  const kept = new Set(newText.split('\n').map(line => line.trim()))
  const lines = oldText
    .split('\n')
    .map(line => line.trim())
    .filter(line => count(line, ASSERTS) > 0 && !kept.has(line))
    .slice(0, 3)
    .map(line => line.slice(0, 120))

  return {
    asserts: [count(oldText, ASSERTS), count(newText, ASSERTS)],
    tests: [count(oldText, TESTS), count(newText, TESTS)],
    skips: [count(oldText, SKIPS), count(newText, SKIPS)],
    tables: [count(oldText, TABLES), count(newText, TABLES)],
    lines,
  }
}

/** The counts of a whole test file. */
export function fileCounts(text: string): FileCounts {
  const { asserts, tests, skips, tables } = measureTestEdit('', text)

  return { asserts: asserts[1], tests: tests[1], skips: skips[1], tables: tables[1] }
}

export function extractNumbers(text: string): string[] {
  const tokens = text.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) ?? []

  return [...new Set(tokens.map(token => token.replaceAll(',', '')))].slice(-NUMBERS_KEPT)
}

export type RawCall = {
  tool: string
  agentId?: string
  command?: string
  path?: string
  oldText?: string
  newText?: string
  /** The whole file as it was before the edit, when the engine gave it. */
  before?: string
  text?: string
  isError?: boolean
  isBackground?: boolean
  isInterrupted?: boolean
  /** The project's root, and where the shell stood before the command: an `rm` names its files from there. */
  root?: string
  stood?: string
  /** The command is the test command the person locked for the game in play. */
  isVerdict?: boolean
}

const EDIT_TOOLS: Record<string, 'edit' | 'write'> = { Edit: 'edit', NotebookEdit: 'edit', Write: 'write' }

// How a shell command ended, as far as the referee can tell.
function stateOf(
  raw: RawCall,
  kind: CommandKind,
  found: readonly Counts[],
  counts: Counts | undefined,
  byWord: boolean,
): ToolRecord['state'] {
  const command = raw.command ?? ''

  if (raw.isBackground || raw.isInterrupted) {
    return 'unknown'
  }
  if (kind !== 'test' && kind !== 'build') {
    return raw.isError ? 'failed' : 'clean'
  }
  // A test run that ran no test proves nothing.
  if (counts !== undefined && counts.passed === 0 && counts.failed === 0) {
    return 'unknown'
  }
  if (isMasked(command)) {
    // The exit code in sight is another command's (`| tail`, `; git status`):
    // only the counts decide, and only when they are the run's own.
    // shortcut: behind a pipe a runner the referee does not know is never read; when people ask,
    // hand the locked command to commands.ts so it finds that run in the chain.
    if (byWord || counts === undefined || !countsAreItsOwn(command)) {
      return 'unknown'
    }

    return counts.failed > 0 ? 'failed' : 'clean'
  }
  if ((counts?.failed ?? 0) > 0) {
    return 'failed'
  }
  if (raw.isError !== true) {
    return 'clean'
  }

  // The chain failed, and no count shows a failure. With other commands in the
  // chain that does not say which one failed:
  //  - no summary at all and a command in front (`cd api && npm test`): the run may never have started;
  //  - a summary with no failure and a command behind (`npm test && git commit`): that one may be what failed.
  const shown = worst(found)
  const maybeInFront = kind === 'test' && shown === undefined && runsAfterAnother(command)
  const maybeBehind = kind === 'test' && shown !== undefined && shown.failed === 0 && runsBeforeAnother(command)

  return maybeInFront || maybeBehind ? 'unknown' : 'failed'
}

export function makeRecord(raw: RawCall, id: number, turn: number, at: number): ToolRecord {
  const text = raw.text ?? ''
  const base = {
    id,
    turn,
    at,
    ...(raw.agentId === undefined ? {} : { agentId: raw.agentId }),
    tool: raw.tool,
    output: text.slice(-OUTPUT_KEPT),
    numbers: extractNumbers(`${raw.command ?? ''} ${raw.newText ?? ''} ${text}`),
  }

  if (raw.command !== undefined) {
    const known = classifyCommand(raw.command)
    // The command the person locked is a test run by their word, though the
    // referee does not know its runner (`make ci`, `python manage.py test`).
    const byWord = raw.isVerdict === true && known !== 'test' && known !== 'build'
    const kind = byWord ? 'test' : known
    const found = kind === 'test' ? summaries(text) : []
    // Beside a command that prints files, a second summary may be a file's text:
    // then the counts belong to nobody, and only an exit code in sight decides.
    const counts = found.length > 1 && sharesOutput(raw.command) ? undefined : worst(found)

    const removed = removedTests(raw.command, raw.root, raw.stood)

    return {
      ...base,
      kind,
      target: raw.command,
      state: stateOf(raw, kind, found, counts, byWord),
      ...(counts ? { counts } : {}),
      ...(removed.length > 0 ? { removed } : {}),
    }
  }

  const editKind = EDIT_TOOLS[raw.tool]
  const path = raw.path ?? ''
  const state = raw.isError ? 'failed' : 'clean'

  if (editKind === undefined) {
    return { ...base, kind: 'tool', target: path, state }
  }

  return {
    ...base,
    kind: editKind,
    target: path,
    state,
    ...(isTestFile(path)
      ? {
          testEdit: {
            ...measureTestEdit(raw.oldText ?? '', raw.newText ?? ''),
            ...(raw.before === undefined ? {} : { file: fileCounts(raw.before) }),
          },
        }
      : {}),
  }
}

export function evidenceLine(r: ToolRecord): string {
  if (r.kind === 'edit' || r.kind === 'write' || r.kind === 'tool') {
    return `${r.tool} ${r.target}`.trim().slice(0, LINE_KEPT)
  }

  const lines = r.output
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
  // The proof of a test run is its own summary, not what a later command printed (`&& git status`).
  const proof = lines.findLast(line => summaries(line).length > 0) ?? lines.at(-1)

  return (proof === undefined ? r.target : `${r.target} → ${proof}`).slice(0, LINE_KEPT)
}
