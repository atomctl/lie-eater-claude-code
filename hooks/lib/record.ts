// The recorder's rules: what one tool call was, and how it ended.
// Plain functions only. Nothing here talks to the engine.
import type { CommandKind, TestEdit, ToolRecord } from '../../types'

const OUTPUT_KEPT = 2000
const NUMBERS_KEPT = 150
const LINE_KEPT = 160

// The order is the priority when one command chains several kinds.
const KINDS: [CommandKind, RegExp][] = [
  [
    'test',
    /\b(pytest|py\.test|jest|vitest|mocha|ava|tox|nox|rspec|phpunit|ctest)\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(go|cargo|deno|dotnet|mvn|gradle\w*)\s+test\b|\bpython3?\s+-m\s+(pytest|unittest)\b|\bnode\s+--test\b|\bmake\s+(test|check)\b|\bclaude\s+plugin\s+test\b/,
  ],
  [
    'build',
    /\b(npm|pnpm|yarn|bun)\s+(run\s+)?build\b|\btsc\b|\b(cargo|go|docker|next|vite|gradle\w*)\s+build\b|\bmvn\s+(package|compile)\b|\bmake(\s+all)?\s*$/,
  ],
  ['lint', /\b(eslint|ruff|flake8|pylint|mypy|biome|clippy|golangci-lint)\b|\bprettier\s+--check\b/],
  ['git', /(^|&&|;)\s*git\s/],
  [
    'install',
    /\b(npm|pnpm|yarn|bun)\s+(install|ci|add)\b|\bpip3?\s+install\b|\buv\s+(add|sync|pip)\b|\bcargo\s+add\b|\bbrew\s+install\b|\bapt(-get)?\s+install\b/,
  ],
]

export function classifyCommand(command: string): CommandKind {
  return KINDS.find(([, pattern]) => pattern.test(command))?.[0] ?? 'other'
}

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

  const passing = output.match(/(\d+) passing/)

  if (passing) {
    return { passed: Number(passing[1]), failed: num(output.match(/(\d+) failing/)) }
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

  if (!passed && !failed) {
    return undefined
  }

  return { passed: num(passed), failed: num(failed) }
}

const TEST_FILE =
  /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go|rb)$|Tests?\.java$|_spec\.rb$/

export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path)
}

export function isCodeFile(path: string): boolean {
  return !/\.(md|txt|rst)$/i.test(path)
}

const ASSERTS = /\bassert\b|\bexpect\(|\bassert_(eq|ne)!|\bassert[A-Z]\w*|\.should\b/g
const TESTS = /\bdef test_\w+|\b[xf]?it(\.\w+)*\s*\(|\btest(\.\w+)*\s*\(|\bfunc Test\w*|#\[test\]|@Test\b/g
const SKIPS =
  /\.skip\s*\(|\bxit\s*\(|\bxdescribe\s*\(|\.todo\s*\(|@pytest\.mark\.skip|@unittest\.skip|\bt\.Skip\(|#\[ignore\]|@Disabled\b|\.only\s*\(|\bfit\s*\(|\bfdescribe\s*\(/g
const TABLES = /\b(test|it|describe)\.each\b|@pytest\.mark\.parametrize|#\[rstest\]|@ParameterizedTest\b/g

const count = (text: string, pattern: RegExp): number => [...text.matchAll(pattern)].length

export function measureTestEdit(oldText: string, newText: string): TestEdit {
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

// One `|` that is not part of `||`: the shell then reports the last command only.
const hasPipe = (command: string): boolean => /(^|[^|])\|([^|]|$)/.test(command)

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
