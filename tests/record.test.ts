import { expect, test } from 'claude-code/testing'

import {
  classifyCommand,
  evidenceLine,
  extractNumbers,
  isCodeFile,
  isShellEdit,
  isTestFile,
  makeRecord,
  measureTestEdit,
  parseCounts,
} from '../hooks/lib/record'
import { rec } from './helpers'

test('classifyCommand names the kind; test wins over build in a chain', async () => {
  const cases: [string, string][] = [
    ['pytest -q', 'test'],
    ['npm test', 'test'],
    ['pnpm run test -- auth', 'test'],
    ['go test ./...', 'test'],
    ['cargo test', 'test'],
    ['python -m unittest', 'test'],
    ['npx vitest run', 'test'],
    ['claude plugin test .', 'test'],
    ['node --test', 'test'],
    ['cd api && npm run build && npm test', 'test'],
    ['npm run build', 'build'],
    ['tsc --noEmit', 'build'],
    ['cargo build --release', 'build'],
    ['ruff check .', 'lint'],
    ['npx eslint src', 'lint'],
    ['git commit -m "x"', 'git'],
    ['npm install left-pad', 'install'],
    ['pip install -r requirements.txt', 'install'],
    ['ls -la', 'other'],
    ['cat tests/test_auth.py', 'other'],
  ]

  for (const [command, kind] of cases) {
    expect(`${command} => ${classifyCommand(command)}`).toBe(`${command} => ${kind}`)
  }
})

test('parseCounts reads the pass and fail counts of each runner', async () => {
  const cases: [string, { passed: number; failed: number } | undefined][] = [
    ['===== 3 failed, 31 passed in 2.10s =====', { passed: 31, failed: 3 }],
    ['===== 34 passed in 1.02s =====', { passed: 34, failed: 0 }],
    ['Tests:       3 failed, 31 passed, 34 total', { passed: 31, failed: 3 }],
    [' Tests  2 failed | 10 passed (12)', { passed: 10, failed: 2 }],
    ['test result: FAILED. 31 passed; 3 failed; 0 ignored', { passed: 31, failed: 3 }],
    ['Ran 34 tests in 0.5s\n\nFAILED (failures=3)', { passed: 31, failed: 3 }],
    ['Ran 34 tests in 0.5s\n\nOK', { passed: 34, failed: 0 }],
    ['  31 passing (2s)\n  3 failing', { passed: 31, failed: 3 }],
    ['ℹ tests 2\nℹ suites 0\nℹ pass 1\nℹ fail 1\nℹ cancelled 0', { passed: 1, failed: 1 }],
    ['Compiled successfully', undefined],
  ]

  for (const [output, counts] of cases) {
    expect({ output, counts: parseCounts(output) }).toEqual({ output, counts })
  }
})

test('isTestFile knows a test file from its path', async () => {
  for (const path of [
    'tests/test_auth.py',
    'src/auth.test.ts',
    'src/__tests__/login.tsx',
    'pkg/auth_test.go',
    'spec/user_spec.rb',
    'src/AuthTest.java',
  ]) {
    expect(`${path} ${isTestFile(path)}`).toBe(`${path} true`)
  }

  for (const path of ['src/auth.ts', 'docs/testing.md', 'src/contest.py', 'src/latest.ts']) {
    expect(`${path} ${isTestFile(path)}`).toBe(`${path} false`)
  }
})

test('isCodeFile: a document is not code', async () => {
  expect(isCodeFile('src/a.py')).toBe(true)
  expect(isCodeFile('README.md')).toBe(false)
  expect(isCodeFile('notes.txt')).toBe(false)
  expect(isCodeFile('docs/guide.rst')).toBe(false)
})

test('measureTestEdit counts checks, tests, skip marks and tables in old and new text', async () => {
  expect(measureTestEdit('assert total == 34\nassert name == "a"', 'assert name == "a"')).toMatchObject({
    asserts: [2, 1],
    lines: ['assert total == 34'],
  })
  expect(measureTestEdit('def test_a():\n  ...\ndef test_b():\n  ...', 'def test_a():\n  ...')).toMatchObject({
    tests: [2, 1],
  })
  expect(measureTestEdit('it("logs in", () => {', 'it.skip("logs in", () => {')).toMatchObject({
    skips: [0, 1],
  })
  expect(measureTestEdit('expect(total).toBe(34)', 'expect(total).toBe(31)')).toMatchObject({
    asserts: [1, 1],
    lines: ['expect(total).toBe(34)'],
  })
  expect(measureTestEdit('it("a", () => {', 'it.only("a", () => {')).toMatchObject({ skips: [0, 1] })

  const ten = Array.from({ length: 10 }, (_, i) => `expect(f(${i})).toBe(${i})`).join('\n')
  const table = 'test.each(cases)("f", (i, o) => { expect(f(i)).toBe(o) })'
  expect(measureTestEdit(ten, table)).toMatchObject({ asserts: [10, 1], tables: [0, 1] })
  expect(measureTestEdit(ten, table).lines).toHaveLength(3)
})

test('extractNumbers finds number tokens and drops thousands commas', async () => {
  expect(extractNumbers('val_acc=0.8612 after 1,204 steps, 86% done')).toEqual(['0.8612', '1204', '86'])
  expect(extractNumbers('no numbers here')).toEqual([])
  expect(extractNumbers(Array.from({ length: 200 }, (_, i) => String(i)).join(' '))).toHaveLength(150)
  expect(extractNumbers(Array.from({ length: 200 }, (_, i) => String(i)).join(' ')).at(-1)).toBe('199')
})

test('makeRecord reads how a call ended', async () => {
  const made = (raw: Parameters<typeof makeRecord>[0]) => makeRecord(raw, 7, 2, 1000)

  expect(made({ tool: 'Bash', command: 'pytest', text: '3 failed, 31 passed', isError: true })).toMatchObject({
    id: 7,
    turn: 2,
    at: 1000,
    kind: 'test',
    target: 'pytest',
    state: 'failed',
    counts: { passed: 31, failed: 3 },
  })
  expect(made({ tool: 'Bash', command: 'pytest', text: '34 passed in 1s' }).state).toBe('clean')
  // the counts win over a clean flag: a pipe hides the failure from the shell
  expect(
    made({ tool: 'Bash', command: 'npm test | tail -5', text: 'Tests: 3 failed, 31 passed, 34 total' }).state,
  ).toBe('failed')
  expect(made({ tool: 'Bash', command: 'npm test | tail -5', text: 'Done.' }).state).toBe('unknown')
  // `|| true` and `; echo` hide the exit code just as a pipe does: the counts decide
  expect(made({ tool: 'Bash', command: 'npm test || true', text: 'Done.' }).state).toBe('unknown')
  expect(made({ tool: 'Bash', command: 'npm test || true', text: 'Tests: 1 failed, 11 passed, 12 total' }).state).toBe('failed')
  expect(made({ tool: 'Bash', command: 'npm test || true', text: 'Tests: 12 passed, 12 total' }).state).toBe('clean')
  expect(made({ tool: 'Bash', command: 'npm test 2>&1; echo "EXIT: $?"', text: 'ℹ pass 2\nℹ fail 0\nEXIT: 0' }).state).toBe('clean')
  expect(made({ tool: 'Bash', command: 'npm test 2>&1; echo "EXIT: $?"', text: 'EXIT: 1' }).state).toBe('unknown')
  expect(made({ tool: 'Bash', command: 'npm run build || true', text: 'error TS2322' }).state).toBe('unknown')
  expect(made({ tool: 'Bash', command: 'cd api && npm test && echo ok', text: 'ok' }).state).toBe('clean')
  expect(made({ tool: 'Bash', command: 'ls | grep x', text: 'x' }).state).toBe('clean')
  expect(made({ tool: 'Bash', command: 'pytest', isBackground: true }).state).toBe('unknown')
  expect(made({ tool: 'Bash', command: 'pytest', isInterrupted: true, isError: true }).state).toBe('unknown')
  expect(
    made({ tool: 'Bash', command: 'npm run build', text: 'Exit code 2\nerror TS2322', isError: true }),
  ).toMatchObject({ kind: 'build', state: 'failed' })
  expect(made({ tool: 'Bash', command: 'npm test', agentId: 'a1', text: '34 passed' }).agentId).toBe('a1')
})

test('makeRecord measures an edit of a test file, and only of a test file', async () => {
  const made = (raw: Parameters<typeof makeRecord>[0]) => makeRecord(raw, 1, 1, 0)

  expect(made({ tool: 'Edit', path: 'tests/test_a.py', oldText: 'assert x == 1', newText: '' })).toMatchObject({
    kind: 'edit',
    target: 'tests/test_a.py',
    testEdit: { asserts: [1, 0] },
  })
  expect(made({ tool: 'Edit', path: 'src/a.py', oldText: 'a', newText: 'b' }).testEdit).toBeUndefined()
  expect(made({ tool: 'Write', path: 'README.md', newText: '# hi' }).kind).toBe('write')
  expect(made({ tool: 'Read', path: 'src/a.py', text: 'x = 0.8612' })).toMatchObject({
    kind: 'tool',
    numbers: ['0.8612'],
  })
})

test('makeRecord keeps the last 2,000 characters of output and the numbers of all of it', async () => {
  const long = `first 0.111 ${'x'.repeat(3000)} last 0.999`
  const made = makeRecord({ tool: 'Bash', command: 'cat big.log', text: long }, 1, 1, 0)

  expect(made.output).toHaveLength(2000)
  expect(made.output.endsWith('last 0.999')).toBe(true)
  expect(made.numbers).toEqual(['0.111', '0.999'])
})

test('evidenceLine shows the command and its last output line, cut to 160 characters', async () => {
  expect(evidenceLine(rec({ target: 'pytest -q', output: 'collected 34\n\n3 failed, 31 passed\n' }))).toBe(
    'pytest -q → 3 failed, 31 passed',
  )
  expect(evidenceLine(rec({ tool: 'Edit', kind: 'edit', target: 'src/a.py' }))).toBe('Edit src/a.py')
  expect(evidenceLine(rec({ target: 'x'.repeat(300), output: 'ok' }))).toHaveLength(160)
})

// ---- from the review of days 1 and 2 ----

test('classifyCommand looks at the command, not at words inside it', async () => {
  const cases: [string, string][] = [
    ['npm i -D vitest', 'install'],
    ['pip install pytest', 'install'],
    ['python -m pip install pytest', 'install'],
    ['cat jest.config.js', 'other'],
    ['git commit -m "fix jest"', 'git'],
    ['echo "npm test"', 'other'],
    ['CI=1 npm test', 'test'],
    ['uv run pytest -q', 'test'],
    ['python3 -m pytest', 'test'],
    ["go test -run 'A|B' ./...", 'test'],
    ['pnpm exec vitest run', 'test'],
  ]

  for (const [command, kind] of cases) {
    expect(`${command} => ${classifyCommand(command)}`).toBe(`${command} => ${kind}`)
  }
})

test('parseCounts reads go test output, and is not fooled by a test name', async () => {
  expect(parseCounts('ok  \texample.com/a\t0.012s\nok  \texample.com/b\t0.004s')).toEqual({ passed: 2, failed: 0 })
  expect(parseCounts('--- FAIL: TestAdd (0.00s)\nFAIL\texample.com/a\t0.012s\nok  \texample.com/b\t0.004s')).toEqual({
    passed: 1,
    failed: 2,
  })
  // a passing mocha run with a test called "returns 1 failing item"
  expect(parseCounts('  ✓ returns 1 failing item\n\n  12 passing (20ms)')).toEqual({ passed: 12, failed: 0 })
})

test('a pipe inside quotes is not a pipe', async () => {
  const made = makeRecord({ tool: 'Bash', command: "go test -run 'A|B' ./...", text: 'ok  \tx\t0.01s' }, 1, 1, 0)

  expect(made).toMatchObject({ kind: 'test', state: 'clean' })
  // go prints no counts line, but a piped run still shows its ok lines
  expect(
    makeRecord({ tool: 'Bash', command: 'go test ./... 2>&1 | tail -20', text: 'ok  \tx\t0.01s' }, 1, 1, 0).state,
  ).toBe('clean')
})

test('isTestFile knows .mjs, .cjs and .mts test files', async () => {
  for (const path of ['src/a.test.mjs', 'src/a.test.cjs', 'src/a.spec.mts']) {
    expect(`${path} ${isTestFile(path)}`).toBe(`${path} true`)
  }
})

test('measureTestEdit: a regex .test( and a model.fit( are not tests or focus marks', async () => {
  expect(measureTestEdit('', 'if (/x/.test(name)) { model.fit(X, y) }')).toMatchObject({ tests: [0, 0], skips: [0, 0] })
  expect(measureTestEdit('it("a", () => {})', 'fit("a", () => {})')).toMatchObject({ tests: [1, 1], skips: [0, 1] })
})

test('measureTestEdit: a test that is commented out is gone', async () => {
  const old = 'it("a", () => {\n  expect(a).toBe(1)\n})'
  const commented = '// it("a", () => {\n//   expect(a).toBe(1)\n// })'

  expect(measureTestEdit(old, commented)).toMatchObject({ asserts: [1, 0], tests: [1, 0] })
  expect(measureTestEdit('def test_a():\n    assert a == 1', '# def test_a():\n#     assert a == 1')).toMatchObject({
    asserts: [1, 0],
    tests: [1, 0],
  })
  // a Rust attribute starts with # and is not a comment
  expect(measureTestEdit('', '#[test]\nfn adds() { assert_eq!(1, 1); }')).toMatchObject({ tests: [0, 1], asserts: [0, 1] })
})

test('isShellEdit: a shell command that changes files', async () => {
  for (const command of [
    "sed -i '' 's/a/b/' src/a.ts",
    'git checkout -- src/a.ts',
    'git stash',
    'npx prettier --write src',
    'npx eslint --fix src',
    'echo "x = 1" >> src/config.py',
    'mv src/a.ts src/b.ts',
  ]) {
    expect(`${command} ${isShellEdit(command)}`).toBe(`${command} true`)
  }
  for (const command of ['npm test 2>&1', 'npm test > /dev/null', 'ls -la', 'git status', 'cat a.ts', 'npm test > out.log']) {
    expect(`${command} ${isShellEdit(command)}`).toBe(`${command} false`)
  }
})
