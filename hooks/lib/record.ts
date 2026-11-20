// The recorder's rules: what one tool call was, and how it ended.
// Plain functions only. Nothing here talks to the engine.
import type { TestEdit, ToolRecord } from '../../types'
import { CODE_FILE, classifyCommand, countsAreItsOwn, isMasked, sharesOutput } from './commands'

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
  // jest and vitest: a line that starts with "Tests"
  for (const m of output.matchAll(/^\s*Tests:?\s+(.*)$/gm)) {
    add(num((m[1] ?? '').match(/(\d+) passed/)), num((m[1] ?? '').match(/(\d+) failed/)))
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
  // node --test: "ℹ pass 2" and "ℹ fail 0"
  for (const m of output.matchAll(/^ℹ pass (\d+)/gm)) add(Number(m[1]), num(output.match(/^ℹ fail (\d+)/m)))
  // go test prints no counts: one `ok` line per passing package, `FAIL` lines for the rest
  const ok = count(output, /^ok\s+\S+/gm)
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

export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path)
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
  text?: string
  isError?: boolean
  isBackground?: boolean
  isInterrupted?: boolean
}

const EDIT_TOOLS: Record<string, 'edit' | 'write'> = { Edit: 'edit', NotebookEdit: 'edit', Write: 'write' }

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
    const kind = classifyCommand(raw.command)
    const found = kind === 'test' ? summaries(text) : []
    // Beside a command that prints files, a second summary may be a file's text:
    // then the counts belong to nobody, and only an exit code in sight decides.
    const counts = found.length > 1 && sharesOutput(raw.command) ? undefined : worst(found)
    const isRun = kind === 'test' || kind === 'build'
    // A hidden exit code leaves only the counts, and only when they are the run's own.
    const isHidden = isRun && isMasked(raw.command) && (!counts || !countsAreItsOwn(raw.command))
    const ranNothing = counts !== undefined && counts.passed === 0 && counts.failed === 0
    const state =
      raw.isBackground || raw.isInterrupted || isHidden || ranNothing
        ? 'unknown'
        : (counts?.failed ?? 0) > 0 || raw.isError
          ? 'failed'
          : 'clean'

    return { ...base, kind, target: raw.command, state, ...(counts ? { counts } : {}) }
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
    ...(isTestFile(path) ? { testEdit: measureTestEdit(raw.oldText ?? '', raw.newText ?? '') } : {}),
  }
}

export function evidenceLine(r: ToolRecord): string {
  if (r.kind === 'edit' || r.kind === 'write' || r.kind === 'tool') {
    return `${r.tool} ${r.target}`.trim().slice(0, LINE_KEPT)
  }

  const lastLine = r.output
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
    .at(-1)

  return (lastLine === undefined ? r.target : `${r.target} → ${lastLine}`).slice(0, LINE_KEPT)
}
