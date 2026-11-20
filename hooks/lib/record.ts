// The recorder's rules: what one tool call was, and how it ended.
// Plain functions only. Nothing here talks to the engine.
import type { TestEdit, ToolRecord } from '../../types'
import { classifyCommand, hasPipe } from './commands'

export { classifyCommand, isShellEdit } from './commands'

const OUTPUT_KEPT = 2000
const NUMBERS_KEPT = 150
const LINE_KEPT = 160

const count = (text: string, pattern: RegExp): number => [...text.matchAll(pattern)].length

const num = (found: RegExpMatchArray | null | undefined): number =>
  found?.[1] === undefined ? 0 : Number(found[1])

const last = (text: string, pattern: RegExp): RegExpMatchArray | undefined =>
  [...text.matchAll(pattern)].at(-1)

export function parseCounts(output: string): { passed: number; failed: number } | undefined {
  const cargo = output.match(/test result: \w+\. (\d+) passed; (\d+) failed/)

  if (cargo) {
    return { passed: Number(cargo[1]), failed: Number(cargo[2]) }
  }

  const ran = output.match(/Ran (\d+) tests? in/)

  if (ran) {
    const bad = output.match(/FAILED \(([^)]*)\)/)?.[1] ?? ''
    const failed = num(bad.match(/failures=(\d+)/)) + num(bad.match(/errors=(\d+)/))

    return { passed: Number(ran[1]) - failed, failed }
  }

  // mocha: the counts stand at the start of their own lines
  const passing = output.match(/^\s*(\d+) passing\b/m)

  if (passing) {
    return { passed: Number(passing[1]), failed: num(output.match(/^\s*(\d+) failing\b/m)) }
  }

  const nodePass = output.match(/^ℹ pass (\d+)/m)

  if (nodePass) {
    return { passed: Number(nodePass[1]), failed: num(output.match(/^ℹ fail (\d+)/m)) }
  }

  // jest and vitest print a "Tests" line under a "Test Suites" / "Test Files"
  // line; pytest prints its summary last.
  const line = output.match(/^\s*Tests:?\s+.*$/m)?.[0] ?? output
  const passed = last(line, /(\d+) passed/g)
  const failed = last(line, /(\d+) failed/g)

  if (passed || failed) {
    return { passed: num(passed), failed: num(failed) }
  }

  // go test prints no counts: one `ok` line per passing package, `FAIL` lines for the rest
  const ok = count(output, /^ok\s+\S+/gm)
  const bad = count(output, /^(?:--- FAIL|FAIL)\b/gm)

  return ok + bad === 0 ? undefined : { passed: ok, failed: bad }
}

const TEST_FILE =
  /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go|rb)$|Tests?\.java$|_spec\.rb$/

export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path)
}

export function isCodeFile(path: string): boolean {
  return !/\.(md|txt|rst)$/i.test(path)
}

const ASSERTS = /\bassert\b|\bexpect\(|\bassert_(eq|ne)!|\bassert[A-Z]\w*|\.should\b/g
// `(?<![.\w])` keeps out a method of the same name: `/re/.test(x)`, `model.fit(X)`.
const TESTS =
  /\bdef test_\w+|(?<![.\w])[xf]?it(\.\w+)*\s*\(|(?<![.\w])test(\.\w+)*\s*\(|\bfunc Test\w*|#\[test\]|@Test\b/g
const SKIPS =
  /\.skip\s*\(|(?<![.\w])xit\s*\(|(?<![.\w])xdescribe\s*\(|\.todo\s*\(|@pytest\.mark\.skip|@unittest\.skip|\bt\.Skip\(|#\[ignore\]|@Disabled\b|\.only\s*\(|(?<![.\w])fit\s*\(|(?<![.\w])fdescribe\s*\(/g
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
    const counts = kind === 'test' ? parseCounts(text) : undefined
    const state =
      raw.isBackground || raw.isInterrupted
        ? 'unknown'
        : (counts?.failed ?? 0) > 0 || raw.isError
          ? 'failed'
          : kind === 'test' && hasPipe(raw.command) && !counts
            ? 'unknown'
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
