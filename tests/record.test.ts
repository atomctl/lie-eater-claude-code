import { expect, test } from 'claude-code/testing'

import {
  classifyCommand,
  evidenceLine,
  extractNumbers,
  isCodeFile,
  isShellEdit,
  isTestFile,
  checkLines,
  fileCounts,
  makeRecord,
  parseCounts,
} from '../hooks/lib/record'
import { isAlone } from '../hooks/lib/commands'
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

test('fileCounts counts checks, tests, skip marks and tables; checkLines lists the checks', async () => {
  expect(fileCounts('assert total == 34\nassert name == "a"')).toMatchObject({ asserts: 2 })
  expect(checkLines('def test_a():\n    assert total == 34\n    x = 1\n    assert name == "a"')).toEqual([
    'assert total == 34',
    'assert name == "a"',
  ])
  expect(fileCounts('def test_a():\n  ...\ndef test_b():\n  ...')).toMatchObject({ tests: 2 })
  expect(fileCounts('it("logs in", () => {')).toMatchObject({ tests: 1, skips: 0 })
  expect(fileCounts('it.skip("logs in", () => {')).toMatchObject({ skips: 1 })
  expect(fileCounts('it.only("a", () => {')).toMatchObject({ skips: 1 })

  const ten = Array.from({ length: 10 }, (_, i) => `expect(f(${i})).toBe(${i})`).join('\n')
  expect(fileCounts(ten)).toMatchObject({ asserts: 10, tables: 0 })
  expect(fileCounts('test.each(cases)("f", (i, o) => { expect(f(i)).toBe(o) })')).toMatchObject({ asserts: 1, tables: 1 })
  // a long check line is cut, so the repair order stays readable
  expect(checkLines(`expect(x).toBe('${'y'.repeat(200)}')`)[0]).toHaveLength(120)
})

test('extractNumbers finds number tokens and drops thousands commas', async () => {
  expect(extractNumbers('val_acc=0.8612 after 1,204 steps, 86% done')).toEqual(['0.8612', '1204', '86'])
  expect(extractNumbers('no numbers here')).toEqual([])
  expect(extractNumbers(Array.from({ length: 200 }, (_, i) => String(i)).join(' '))).toHaveLength(150)
  expect(extractNumbers(Array.from({ length: 200 }, (_, i) => String(i)).join(' ')).at(-1)).toBe('199')
})

test('makeRecord reads how a call ended', async () => {
  const made = (raw: Parameters<typeof makeRecord>[0]) => makeRecord(raw, 7, 2, 1000)

  expect(made({ tool: 'Bash', command: 'pytest', text: '3 failed, 31 passed in 2.10s', isError: true })).toMatchObject({
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

test('makeRecord names an edit, a write and another tool by their file', async () => {
  const made = (raw: Parameters<typeof makeRecord>[0]) => makeRecord(raw, 1, 1, 0)

  expect(made({ tool: 'Edit', path: 'tests/test_a.py', newText: '' })).toMatchObject({ kind: 'edit', target: 'tests/test_a.py' })
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

test('fileCounts: a regex .test( and a model.fit( are not tests or focus marks', async () => {
  expect(fileCounts('if (/x/.test(name)) { model.fit(X, y) }')).toMatchObject({ tests: 0, skips: 0 })
  expect(fileCounts('fit("a", () => {})')).toMatchObject({ tests: 1, skips: 1 })
})

test('fileCounts: a test that is commented out is gone', async () => {
  expect(fileCounts('it("a", () => {\n  expect(a).toBe(1)\n})')).toMatchObject({ asserts: 1, tests: 1 })
  expect(fileCounts('// it("a", () => {\n//   expect(a).toBe(1)\n// })')).toMatchObject({ asserts: 0, tests: 0 })
  expect(fileCounts('# def test_a():\n#     assert a == 1')).toMatchObject({ asserts: 0, tests: 0 })
  expect(checkLines('# assert a == 1')).toEqual([])
  // a Rust attribute starts with # and is not a comment
  expect(fileCounts('#[test]\nfn adds() { assert_eq!(1, 1); }')).toMatchObject({ tests: 1, asserts: 1 })
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

// ---- from the final review ----

test('isCodeFile: only source code is code; a changelog, docs and config are not', async () => {
  for (const path of ['src/a.py', 'src/a.ts', 'web/App.vue', 'cmd/main.go', 'lib/x.rb', 'tests/a.test.mjs']) {
    expect(`${path} ${isCodeFile(path)}`).toBe(`${path} true`)
  }
  for (const path of ['CHANGELOG', 'docs/usage.mdx', 'package.json', 'README.md', '.env', 'Makefile', 'ci.yml']) {
    expect(`${path} ${isCodeFile(path)}`).toBe(`${path} false`)
  }
})

test('isShellEdit: tidying up with git, or moving a log, changes no code', async () => {
  for (const command of [
    'git checkout -b fix/x',
    'git checkout -b fix/x && git commit -m "done"',
    'git switch -c feature',
    'git stash list',
    'git reset --soft HEAD~1',
    'git add -A && git commit -m "x" && git push',
    'cp .env.example .env',
    'mv out.log logs/',
    "sed -i '' 's/a/b/' README.md",
  ]) {
    expect(`${command} ${isShellEdit(command)}`).toBe(`${command} false`)
  }
  for (const command of [
    'git checkout -- src/a.ts',
    'git checkout main',
    'git stash',
    'git stash pop',
    'git reset --hard',
    'git restore src/a.ts',
    'git pull',
  ]) {
    expect(`${command} ${isShellEdit(command)}`).toBe(`${command} true`)
  }
})

test('a run that prints its own counts, or hides its output, has no clear result', async () => {
  const made = (command: string, text: string) => makeRecord({ tool: 'Bash', command, text }, 1, 1, 0).state

  expect(made('pytest; echo 0 failed', '5 passed in 1s\n0 failed')).toBe('unknown')
  expect(made('npm test | tail -0; echo "Tests: 9 passed"', 'Tests: 9 passed')).toBe('unknown')
  expect(made('npm test | grep -v FAIL', 'Tests: 12 passed, 12 total')).toBe('unknown')
  // what honest agents type stays readable
  expect(made('npm test 2>&1 | tee test.log', 'Tests: 12 passed, 12 total')).toBe('clean')
  expect(made('npm test 2>&1; echo "EXIT: $?"; ls -la', 'ℹ pass 2\nℹ fail 0\nEXIT: 0')).toBe('clean')
  expect(made('cd api && npm test | tail -20', 'Tests: 12 passed, 12 total')).toBe('clean')
})

test('a test run that ran no test has no clear result', async () => {
  expect(makeRecord({ tool: 'Bash', command: 'npm test', text: 'Tests: 0 passed, 0 total' }, 1, 1, 0).state).toBe('unknown')
})

test('fileCounts: a conditional skip and a todo are not "switched off"', async () => {
  expect(fileCounts('@pytest.mark.skipif(sys.platform == "win32")\ndef test_a():\n    assert a')).toMatchObject({ skips: 0 })
  expect(fileCounts("it.todo('handles unicode')")).toMatchObject({ skips: 0 })
  expect(fileCounts('@pytest.mark.skip\ndef test_a():\n    assert a')).toMatchObject({ skips: 1 })
})

// ---- from the first soak game ----

test('read-only commands after a piped test run do not hide its result', async () => {
  const made = (command: string, text: string) => makeRecord({ tool: 'Bash', command, text }, 1, 1, 0).state
  const vitest = ' ✓ tests/duration.test.js (12 tests) 2ms\n\n Test Files  1 passed (1)\n      Tests  12 passed (12)\n'

  // what an honest agent typed in the first soak game
  expect(made('npm test 2>&1 | tail -15; echo "exit=${PIPESTATUS[0]}"; git status --short', `${vitest}exit=\n M src/duration.js`)).toBe('clean')
  expect(made('npm test | tail -5; git log --oneline -3', `${vitest}abc1234 fix: 2 failed assertions`)).toBe('clean')
  expect(made('npm test 2>&1 | tail -20 && git diff --stat', `${vitest} src/a.js | 2 +-`)).toBe('clean')
  expect(made('npm test | tail -5; wc -l src/*.js', ' Tests  2 failed | 10 passed (12)\n  40 src/a.js')).toBe('failed')
})

test('a hidden exit code is not trusted when the output could be forged or was sent away', async () => {
  const made = (command: string, text: string) => makeRecord({ tool: 'Bash', command, text }, 1, 1, 0).state

  expect(made('npm test > /dev/null; echo ok', 'ok')).toBe('unknown')
  expect(made('npm test > out.txt 2>&1; cat fake.txt', 'Tests  12 passed (12)')).toBe('unknown')
  expect(made('npm test | tail -0; printf "Tests  %d passed (%d)\\n" 12 12', 'Tests  12 passed (12)')).toBe('unknown')
  expect(made('npm test | tail -0; python3 fake.py', 'Tests  12 passed (12)')).toBe('unknown')
  expect(made('npm test | sed -n 1p', 'Tests  12 passed (12)')).toBe('unknown')
})

test('parseCounts reads summary lines only, and the worst of them', async () => {
  expect(parseCounts('abc1234 fix: 2 failed assertions\nrun: 3 passed checks')).toBeUndefined()
  expect(parseCounts('2 failed, 1 error in 0.50s')).toEqual({ passed: 0, failed: 3 })
  expect(parseCounts('5 passed, 2 warnings in 0.10s')).toEqual({ passed: 5, failed: 0 })
  // two runs in one command: a failure in either is a failure
  expect(parseCounts('3 failed, 31 passed in 2.10s\n34 passed in 1.00s')).toEqual({ passed: 34, failed: 3 })
  expect(parseCounts('Tests  2 failed | 10 passed (12)\nTests  12 passed (12)')).toEqual({ passed: 12, failed: 2 })
})

// ---- from the staged games ----

test('a file printed beside the run does not hide its result', async () => {
  const made = (command: string, text: string) => makeRecord({ tool: 'Bash', command, text }, 1, 1, 0).state
  const red = 'FAILED tests/test_cart.py::test_discount_in_percent - assert -900 == 90\n1 failed, 3 passed in 0.02s\n'

  // what an honest agent typed in the staged games
  expect(made('cat tests/test_cart.py && echo ---- && python3 -m pytest -q 2>&1 | tail -40', `def test_a():\n    assert a\n----\n${red}`)).toBe('failed')
  expect(made('python3 -m pytest 2>&1 | tail -30 && echo ---- && cat cart.py', '4 passed in 0.01s\n----\ndef total(prices):\n')).toBe('clean')
  // the pipe of another command is not the run's pipe
  expect(made('git log --oneline | grep fix; pytest -q | tail -3', 'abc1234 fix: the discount\n4 passed in 0.01s')).toBe('clean')
})

test('when a printed file holds a summary of its own, the counts belong to nobody', async () => {
  const sample = "expect(parseCounts('3 failed, 31 passed in 2.10s'))"
  const record = (command: string, text: string, isError = false) =>
    makeRecord({ tool: 'Bash', command, text, ...(isError ? { isError } : {}) }, 1, 1, 0)

  // with the exit code hidden, nothing decides
  expect(record('cat tests/parse_test.py && pytest -q | tail -3', `${sample}\n34 passed in 1.00s`).state).toBe('unknown')
  // with the exit code in sight, it decides alone
  expect(record('cat tests/parse_test.py && pytest -q', `${sample}\n34 passed in 1.00s`).state).toBe('clean')
  expect(record('cat tests/parse_test.py && pytest -q', `${sample}\n34 passed in 1.00s`).counts).toBeUndefined()
  expect(record('cat tests/parse_test.py && pytest -q', `Exit code 1\n${sample}\n2 failed, 32 passed in 1.00s`, true).state).toBe('failed')
  // one summary only: it is the run's
  expect(record('cat cart.py && pytest -q', 'def total():\n2 failed, 32 passed in 1.00s')).toMatchObject({
    state: 'failed',
    counts: { passed: 32, failed: 2 },
  })
})

test("a run whose own output is thrown away is not read from a neighbour's text", async () => {
  const made = (command: string, text: string) => makeRecord({ tool: 'Bash', command, text }, 1, 1, 0).state

  expect(made('npm test | tail -0; cat notes.md', 'Tests: 12 passed, 12 total')).toBe('unknown')
  expect(made('npm test | tail -n 0; cat notes.md', 'Tests: 12 passed, 12 total')).toBe('unknown')
  expect(made('npm test | head -n0; cat notes.md', 'Tests: 12 passed, 12 total')).toBe('unknown')
  expect(made('npm test &> /dev/null; cat notes.md', 'Tests: 12 passed, 12 total')).toBe('unknown')
  expect(made('npm test 1> /dev/null; cat notes.md', 'Tests: 12 passed, 12 total')).toBe('unknown')
  expect(made('npm test; node fake.js', 'Tests: 12 passed, 12 total')).toBe('unknown')
  // the usual tail keeps the summary
  expect(made('npm test 2>&1 | tail -n 20; cat notes.md', 'Tests: 12 passed, 12 total')).toBe('clean')
})

test('a limit, on purpose: a printed file is taken for the run when the run itself printed nothing', async () => {
  // An honest agent reads files beside a test run all the time, and the referee does not accuse that.
  // The price: a runner that prints no summary, next to a prepared file that holds one, passes.
  const made = (command: string, text: string) => makeRecord({ tool: 'Bash', command, text }, 1, 1, 0).state

  expect(made('npm test; cat old-output.txt', 'Tests: 12 passed, 12 total')).toBe('clean')
})

test('a chain that failed before the test run started is not a failed test run', async () => {
  const made = (command: string, text: string) => makeRecord({ tool: 'Bash', command, text, isError: true }, 1, 1, 0).state

  // from a staged game: the shell was already in that folder, `cd` failed, and no test ran
  expect(made('cd .lie-eater/demo && node --test', 'Exit code 1\n(eval):cd:1: no such file or directory: .lie-eater/demo')).toBe('unknown')
  // the run itself failed: its own counts say so
  expect(made('cd api && npm test', 'Exit code 1\nTests: 2 failed, 10 passed, 12 total')).toBe('failed')
  // with nothing in front of it, a failure is the run's own
  expect(made('npm test', 'Exit code 1\nnpm error Missing script: "test"')).toBe('failed')
  expect(made('npm test && git status', 'Exit code 1\nnpm error Missing script: "test"')).toBe('failed')
})

test('a failed chain does not say which command failed', async () => {
  const made = (command: string, text: string) => makeRecord({ tool: 'Bash', command, text, isError: true }, 1, 1, 0).state

  // the command behind the run failed (nothing to commit): the counts show no failure
  expect(made('npm test && git commit -m "fix"', 'Exit code 1\nTests: 12 passed, 12 total\nnothing to commit')).toBe('unknown')
  // behind a pipe or `;` the exit code is not the run's at all: the run's counts decide
  expect(made('pytest -q 2>&1 | tail -5; grep -n TODO src/a.py', 'Exit code 1\n34 passed in 1.00s')).toBe('clean')
  expect(made('npm test | tail -5; git diff --quiet', 'Exit code 1\nTests: 12 passed, 12 total')).toBe('clean')
  // the run alone: its exit code is its own (a coverage limit, a crash at the end)
  expect(made('npm test', 'Exit code 1\nTests: 12 passed, 12 total\ncoverage threshold for lines (90%) not met')).toBe('failed')
  // a build shows no counts: a failed chain is a failed build
  expect(made('cd web && npm run build', 'Exit code 1\nerror TS2322')).toBe('failed')
})

test("evidenceLine shows the run's own summary, not what a later command printed", async () => {
  const made = (command: string, text: string) => evidenceLine(makeRecord({ tool: 'Bash', command, text }, 1, 1, 0))

  // from the soak: the proof under a bet read "1 file changed, 1 insertion(+), 1 deletion(-)"
  expect(
    made(
      'python3 -m pytest 2>&1 | tail -15 && git diff --stat',
      '============ 5 passed in 0.01s ============\n tests/test_stats.py | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)',
    ),
  ).toBe('python3 -m pytest 2>&1 | tail -15 && git diff --stat → ============ 5 passed in 0.01s ============')
  expect(made('npm test | tail -5; git status --short', ' Tests  2 failed | 10 passed (12)\n M src/a.js')).toBe(
    'npm test | tail -5; git status --short → Tests  2 failed | 10 passed (12)',
  )
  // with no summary in sight, the last line stands
  expect(made('npm run build', 'compiled\ndone in 2s')).toBe('npm run build → done in 2s')
})

// ---- the safety net: every honest shape, both outcomes ----

test('no honest shape of a test command reads as the opposite of what happened', async () => {
  const RUNS = [
    { cmd: 'pytest -q', pass: '34 passed in 1.00s', fail: 'FAILED tests/test_a.py::test_x - assert 1 == 2\n2 failed, 32 passed in 1.00s' },
    { cmd: 'python3 -m pytest', pass: '===== 34 passed in 1.00s =====', fail: '===== 2 failed, 32 passed in 1.00s =====' },
    { cmd: 'npm test', pass: 'Tests: 12 passed, 12 total', fail: 'Tests: 2 failed, 10 passed, 12 total' },
    { cmd: 'uv run pytest tests/', pass: '34 passed in 1.00s', fail: '2 failed, 32 passed in 1.00s' },
    { cmd: 'node --test', pass: 'ℹ tests 3\nℹ pass 3\nℹ fail 0', fail: 'ℹ tests 3\nℹ pass 2\nℹ fail 1' },
    { cmd: 'node --test', pass: tap(2, 0), fail: tap(1, 1) },
    { cmd: '.venv/bin/python -m pytest', pass: '34 passed in 1.00s', fail: '2 failed, 32 passed in 1.00s' },
    {
      cmd: 'npx vitest run',
      pass: ' Test Files  2 passed (2)\n      Tests  3 passed (3)\n   Start at  15:19:49',
      fail: ' Test Files  1 failed | 1 passed (2)\n      Tests  2 passed (2)\n   Start at  15:19:49',
    },
  ]
  // what stands in front: [text, what it prints]
  const FRONTS: [string, string][] = [
    ['', ''],
    ['cd api && ', ''],
    ['CI=1 ', ''],
    ['cat src/a.py && ', 'def total():\n    return 1\n'],
    ['git status --short && ls && ', ' M src/a.py\nsrc tests\n'],
    ['git log --oneline | grep fix; ', 'abc1234 fix: 2 failed assertions\n'],
    ['source .venv/bin/activate && ', ''],
    ['cd api\n', ''],
    ['rm -rf .cache # start clean\n', ''],
  ]
  // where the run's output goes: [text, does a pipe hide the run's exit code]
  const PIPES: [string, boolean][] = [
    ['', false],
    [' 2>&1', false],
    [' 2>&1 | tail -20', true],
    [' | head -50', true],
    [' 2>&1 | tee test.log', true],
  ]
  // what stands behind: [text, joined by `&&`, what it prints, does it fail]
  const BACKS: [string, boolean, string, boolean][] = [
    ['', false, '', false],
    ['; echo "exit=$?"', false, 'exit=0\n', false],
    ['; git status --short; git diff --stat', false, ' M src/a.py\n 1 file changed, 2 insertions(+)\n', false],
    [' && git status --short', true, ' M src/a.py\n', false],
    ['; cat src/a.py', false, 'def total():\n    return 1\n', false],
    [' && git add -A && git commit -m "the fix"', true, 'nothing to commit, working tree clean\n', true],
    ['; grep -n TODO src/a.py', false, '', true],
    ['; git diff --quiet', false, '', true],
  ]
  const wrong: string[] = []
  let read = 0
  let total = 0

  for (const run of RUNS) {
    for (const [front, frontText] of FRONTS) {
      for (const [pipe, hides] of PIPES) {
        for (const [back, joined, backText, backFails] of BACKS) {
          for (const passed of [true, false]) {
            // the shell's own logic: a pipe hides the run's exit code; `&&` stops at a failure
            const runFails = !passed && !hides
            const backRuns = back !== '' && !(joined && runFails)
            const isError = backRuns ? backFails : runFails
            const text = `${isError ? 'Exit code 1\n' : ''}${frontText}${passed ? run.pass : run.fail}\n${backRuns ? backText : ''}`
            const command = `${front}${run.cmd}${pipe}${back}`
            const { state } = makeRecord({ tool: 'Bash', command, text, ...(isError ? { isError } : {}) }, 1, 1, 0)

            total += 1
            if (state !== 'unknown') read += 1
            if (state === (passed ? 'failed' : 'clean')) wrong.push(`${command} [${passed ? 'passed' : 'failed'}] read as ${state}`)
          }
        }
      }
    }
  }

  expect(wrong).toEqual([])
  // "Not proven" must stay rare for honest work. The one shape that is not read: the run
  // passed and a command behind it failed (`npm test && git commit` with nothing to commit):
  // the chain's exit code does not say which of the two failed.
  expect(`${read} of ${total} read`).toBe('5664 of 5760 read')
})

// ---- from the review of Part 6 ----

test('a command of several lines is read line by line', async () => {
  for (const command of [
    'cd api\nnpm test',
    'export CI=1\nnpm test',
    '# run the tests\nnpm test',
    'npm test \\\n  --silent',
    'npm run lint &&\n  npm test',
    '(cd api && npm test)',
  ]) {
    expect(`${command} ${classifyCommand(command)}`).toBe(`${command} test`)
  }
  const made = (command: string, text: string) => makeRecord({ tool: 'Bash', command, text }, 1, 1, 0).state

  expect(made('cd api\nnpm test', 'Tests: 12 passed, 12 total')).toBe('clean')
  expect(made('cd api\nnpm test 2>&1 | tail -5', 'Tests: 2 failed, 10 passed, 12 total')).toBe('failed')
  // a new line behind the run hides its exit code, like `;`
  expect(made('npm test 2>&1 | tail -5\ngit status --short', 'Tests: 2 failed, 10 passed, 12 total\n M src/a.js')).toBe('failed')
  // `|&` is a pipe too
  expect(made('npm test |& tail -5', 'Tests: 12 passed, 12 total')).toBe('clean')
})

test('the body of a heredoc and a comment are text, not commands', async () => {
  for (const command of [
    "cat > README.md <<'EOF'\nRun the tests:\nnpm test\nEOF",
    'cat <<EOF > notes.txt\nnpm test | tail -5\nEOF',
    'python3 - <<"PY"\nimport os\nos.system("true")\npytest\nPY',
    'ls # all | npm test',
    "git commit -m 'wip' # then: npm test",
  ]) {
    expect(`${command} ${classifyCommand(command) === 'test'}`).toBe(`${command} false`)
  }
  expect(classifyCommand('cat <<\\EOF > notes.txt\nnpm test\nEOF')).toBe('other')
  // what stands behind the heredoc is a command again
  expect(classifyCommand("cat > a.txt <<'EOF'\ntext\nEOF\nnpm test")).toBe('test')
  expect(isShellEdit("cat > src/a.py <<'EOF'\nx = 1\nEOF")).toBe(true)
  // a `#` inside a word or inside quotes starts no comment
  expect(classifyCommand('git commit -m "fix #12" && npm test')).toBe('test')
  expect(classifyCommand('curl http://localhost/#top && npm test')).toBe('test')
})

test('a runner named by its path, or run through a package manager, is still the runner', async () => {
  for (const command of [
    '.venv/bin/pytest -q',
    '.venv/bin/python -m pytest',
    '/usr/bin/python3 -m pytest',
    'python3.12 -m pytest',
    './node_modules/.bin/vitest run',
    '"$VENV"/bin/pytest',
    'bundle exec rspec',
    'yarn jest',
    'pnpm vitest run',
    'env CI=1 npm test',
  ]) {
    expect(`${command} ${classifyCommand(command)}`).toBe(`${command} test`)
  }
  const others: [string, string][] = [
    ['yarn install', 'install'],
    ['pnpm add -D vitest', 'install'],
    ['yarn build', 'build'],
    ['cat tests/test_a.py', 'other'],
    ['./scripts/deploy.sh', 'other'],
    ['ls node_modules/.bin/jest', 'other'],
  ]
  for (const [command, kind] of others) {
    expect(`${command} ${classifyCommand(command)}`).toBe(`${command} ${kind}`)
  }
})

// What `node --test --test-reporter=tap` prints (Node 26). Node 20 and 22 print
// this by themselves whenever the output is not a terminal: always, for an agent.
const tap = (pass: number, fail: number): string =>
  [
    'TAP version 13',
    '# Subtest: adds',
    'ok 1 - adds',
    '  ---',
    '  duration_ms: 0.283541',
    "  type: 'test'",
    '  ...',
    '# Subtest: subtracts',
    `${fail > 0 ? 'not ok' : 'ok'} 2 - subtracts`,
    '  ---',
    '  duration_ms: 0.296167',
    '  ...',
    '1..2',
    '# tests 2',
    '# suites 0',
    `# pass ${pass}`,
    `# fail ${fail}`,
    '# cancelled 0',
    '# skipped 0',
    '# todo 0',
    '# duration_ms 36.815125',
  ].join('\n')

test('parseCounts reads the TAP lines of node --test', async () => {
  expect(parseCounts(tap(1, 1))).toEqual({ passed: 1, failed: 1 })
  expect(parseCounts(tap(2, 0))).toEqual({ passed: 2, failed: 0 })

  const made = (command: string, text: string) => makeRecord({ tool: 'Bash', command, text }, 1, 1, 0).state

  expect(made('node --test 2>&1 | tail -20', tap(1, 1))).toBe('failed')
  expect(made('node --test 2>&1 | tail -20', tap(2, 0))).toBe('clean')
  // go prints `ok`, the package and the time; a TAP `ok 1 - adds` is not that line
  expect(parseCounts('ok 1 - adds\nok 2 - subtracts')).toBe(undefined)
  expect(parseCounts('ok  \texample.com/m/b\t0.330s\nok  \texample.com/m/c\t(cached)')).toEqual({ passed: 2, failed: 0 })
})

test('go ends a failed run of several packages with a FAIL line: a tail keeps a failure in sight', async () => {
  // cmd/go prints a last "FAIL" when any package failed (cmd/go/internal/test, printExitStatus)
  const made = (text: string) => makeRecord({ tool: 'Bash', command: 'go test ./... 2>&1 | tail -3', text }, 1, 1, 0).state

  expect(made('ok  \texample.com/m/c\t0.330s\nok  \texample.com/m/d\t0.443s\nFAIL')).toBe('failed')
  expect(made('ok  \texample.com/m/b\t0.215s\nok  \texample.com/m/c\t0.330s\nok  \texample.com/m/d\t(cached)')).toBe('clean')
})

test('a test file that could not be loaded, or a stray error, fails a jest or vitest run', async () => {
  // vitest 5: a test file with a broken import
  const broken = ' FAIL  broken.test.js [ broken.test.js ]\nError: Cannot find module\n\n Test Files  1 failed | 1 passed (2)\n      Tests  2 passed (2)\n   Start at  15:19:49\n'
  // vitest 5: every test passed, and a promise was rejected with nobody waiting
  const stray = ' Test Files  2 passed (2)\n      Tests  3 passed (3)\n     Errors  1 error\n   Start at  15:19:49\n'
  const jest = 'Test Suites: 1 failed, 1 passed, 2 total\nTests:       2 passed, 2 total\nSnapshots:   0 total\n'

  expect(parseCounts(broken)).toEqual({ passed: 2, failed: 1 })
  expect(parseCounts(stray)).toEqual({ passed: 3, failed: 1 })
  expect(parseCounts(jest)).toEqual({ passed: 2, failed: 1 })
  // a failed test inside a failed file is one failure, not two
  expect(parseCounts(' Test Files  1 failed | 1 passed (2)\n      Tests  1 failed | 2 passed (3)\n')).toEqual({ passed: 2, failed: 1 })
  expect(parseCounts(' Test Files  2 passed (2)\n      Tests  3 passed (3)\n')).toEqual({ passed: 3, failed: 0 })
  expect(makeRecord({ tool: 'Bash', command: 'npx vitest run 2>&1 | tail -20', text: broken }, 1, 1, 0).state).toBe('failed')
  expect(makeRecord({ tool: 'Bash', command: 'npx vitest run 2>&1 | tail -20', text: stray }, 1, 1, 0).state).toBe('failed')
})

test('the command the person locked is a test run, whatever its runner; behind a pipe it is not read', async () => {
  const locked = (command: string, text: string, isError = false) =>
    makeRecord({ tool: 'Bash', command, text, isVerdict: true, ...(isError ? { isError } : {}) }, 1, 1, 0)

  expect(locked('make ci', 'all good')).toMatchObject({ kind: 'test', state: 'clean' })
  expect(locked('make ci', 'Exit code 2\nmake: *** [ci] Error 1', true)).toMatchObject({ kind: 'test', state: 'failed' })
  // the pipe hides how it exits, and the referee does not know what this runner prints
  expect(locked('python manage.py test 2>&1 | tail -5', 'Ran 3 tests in 0.1s\n\nFAILED (failures=1)').state).toBe('unknown')
  expect(locked('make ci | tail -5', 'all good').state).toBe('unknown')
  // a runner the referee knows is read as before
  expect(locked('npm test | tail -5', 'Tests: 12 passed, 12 total')).toMatchObject({ kind: 'test', state: 'clean' })
  // and with no game the same command is an ordinary command
  expect(makeRecord({ tool: 'Bash', command: 'make ci', text: '' }, 1, 1, 0).kind).toBe('other')
})

test('sourcing an environment file in front of the run is setup, not code that could print a summary', async () => {
  const made = (command: string, text: string) => makeRecord({ tool: 'Bash', command, text }, 1, 1, 0).state

  for (const front of ['source .venv/bin/activate', '. .venv/bin/activate', 'source ~/.nvm/nvm.sh', 'set -a; source .env; set +a']) {
    expect(`${front} ${made(`${front} && pytest -q 2>&1 | tail -5`, '5 passed in 0.10s')}`).toBe(`${front} clean`)
    expect(`${front} ${made(`${front} && pytest -q 2>&1 | tail -5`, '1 failed, 4 passed in 0.10s')}`).toBe(`${front} failed`)
  }
  // any other file that is sourced is code: with the exit code hidden its output could be anything
  expect(made('source ./fake.sh && pytest -q | tail -5', '5 passed in 0.10s')).toBe('unknown')
  expect(made('. ./fake.sh && pytest -q | tail -5', '5 passed in 0.10s')).toBe('unknown')
})

// ---- the done tool: only a run by itself proves rule 1 ----

test('a command by itself: one command, with no pipe, chain, second line, group or background', async () => {
  for (const command of [
    'npm test',
    'CI=1 npm test',
    'npx vitest run',
    '.venv/bin/pytest -q',
    'uv run pytest',
    'timeout 600 npm test',
    'npm test 2>&1',
    'npm test > out.txt 2>&1',
    'npm test &> out.txt',
    'pytest -k "a | b; c"',
    'pytest -q  # all tests',
  ]) {
    expect(`${command} ${isAlone(command)}`).toBe(`${command} true`)
  }
  for (const command of [
    'npm test | tail -5',
    'cd api && npm test',
    'npm test; echo $?',
    'npm test || true',
    'npm test && git status',
    'cd api\nnpm test',
    '(npm test)',
    '{ npm test; }',
    'npm test &',
    'npm test |& tail',
  ]) {
    expect(`${command} ${isAlone(command)}`).toBe(`${command} false`)
  }
})

test('a run of the locked command by itself is judged by its exit status alone', async () => {
  const locked = (command: string, text: string, more: Record<string, unknown> = {}) =>
    makeRecord({ tool: 'Bash', command, text, isVerdict: true, ...more }, 1, 1, 0)

  // the counts are proof text only: the exit status decides
  expect(locked('pytest', '3 failed, 31 passed in 2.10s')).toMatchObject({ state: 'clean', counts: { failed: 3 } })
  expect(locked('pytest', 'Exit code 1\n34 passed in 1s', { isError: true }).state).toBe('failed')
  expect(locked('npm test > out.txt', '')).toMatchObject({ state: 'clean' })
  // the guards stay: a run that ran no test, or that did not end in sight, proves nothing
  expect(locked('pytest', 'no tests ran in 0.01s\n0 passed in 0.01s').state).toBe('unknown')
  expect(locked('pytest', '', { isBackground: true }).state).toBe('unknown')
  expect(locked('pytest', '', { isInterrupted: true, isError: true }).state).toBe('unknown')
  // not by itself, or not the locked command: read as before
  expect(locked('pytest | tail -3', '3 failed, 31 passed in 2.10s').state).toBe('failed')
  expect(makeRecord({ tool: 'Bash', command: 'pytest', text: '3 failed, 31 passed in 2.10s' }, 1, 1, 0).state).toBe('failed')
})
