import { expect, test } from 'claude-code/testing'

import { masked } from '../hooks/lib/commands'
import { alsoOf, armWatch, cannotCheck, detectVerdict, isKept, isPlainRun, packageShortcut, plainCommand, rule, runKind, track } from '../hooks/lib/terms'
import type { Change, Terms, ToolRecord } from '../types'
import { rec } from './helpers'

const P = 'print-1' // the project's fingerprint as it is
const edit = (id: number, path = 'src/a.ts') => rec({ id, tool: 'Edit', kind: 'edit', target: path })
const run = (id: number, state: ToolRecord['state'] = 'clean', more: Partial<ToolRecord> = {}) =>
  rec({ id, kind: 'test', target: 'npm test', state, ...more })
/** A record, or a record and the fingerprint taken when that run started. */
type Step = ToolRecord | [ToolRecord, string]
const play = (steps: Step[], before: ToolRecord[] = [], armed = P): Terms =>
  steps.reduce<Terms>(
    (t, step) => (Array.isArray(step) ? track(t, step[0], step[1]) : track(t, step)),
    { ...armWatch('npm test', { id: 1, at: 0 }, before), print: armed },
  )
const line = (steps: Step[], now: string | undefined = P, before: ToolRecord[] = []) =>
  rule(play(steps, before), [], now).find(l => l.term === 'verdict')

test('detectVerdict finds the test command from the files of the project', async () => {
  expect(detectVerdict({ 'package.json': '{"scripts":{"test":"vitest run"}}' })).toBe('npm test')
  expect(
    detectVerdict({ 'package.json': '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' }),
  ).toBeUndefined()
  expect(detectVerdict({ 'pyproject.toml': '[tool.pytest.ini_options]' })).toBe('pytest')
  expect(detectVerdict({ 'pytest.ini': '[pytest]' })).toBe('pytest')
  expect(detectVerdict({ 'Cargo.toml': '[package]' })).toBe('cargo test')
  expect(detectVerdict({ 'go.mod': 'module x' })).toBe('go test ./...')
  expect(detectVerdict({ Makefile: 'build:\n\tgo build\ntest:\n\tgo test' })).toBe('make test')
  expect(detectVerdict({ Makefile: 'build:\n\tgo build' })).toBeUndefined()
  expect(detectVerdict({ 'package.json': '{oops' })).toBeUndefined()
  expect(detectVerdict({})).toBeUndefined()
})

test('detectVerdict: test files with no config file are enough', async () => {
  expect(detectVerdict({}, ['forth.py', 'forth_test.py'])).toBe('pytest')
  expect(detectVerdict({}, ['src', 'tests/test_api.py'])).toBe('pytest')
  expect(detectVerdict({}, ['main.go', 'main_test.go'])).toBe('go test ./...')
  expect(detectVerdict({}, ['contest.py', 'latest.py', 'README.md'])).toBeUndefined()
  // a config file wins over a guess from the file names
  expect(detectVerdict({ 'package.json': '{"scripts":{"test":"vitest run"}}' }, ['legacy_test.py'])).toBe('npm test')
})

test('arming takes over what the record already knows', async () => {
  const before = [rec({ id: 3, kind: 'test', target: 'npm test' }), edit(5)]

  expect(armWatch('npm test', { id: 1, at: 0 }, before)).toMatchObject({
    id: 1,
    verdict: 'npm test',
    startRecord: 5,
    lastGatedRun: 3,
    lastEdit: 5,
    fixes: 0,
  })
  expect(armWatch('npm test', { id: 1, at: 0 }, before).fullRun).toBeUndefined()
  expect(armWatch('npm test', { id: 1, at: 0 }, before).startFailed).toBeUndefined()
  expect(armWatch('npm test', { id: 1, at: 0 }, []).startRecord).toBe(0)
  expect(
    armWatch('npm test', { id: 1, at: 0 }, [run(2, 'failed', { counts: { passed: 1, failed: 3 } })]).startFailed,
  ).toBe(3)
})

// ---- the full check: the locked command, by itself, with harmless flags only ----

test('runKind: the locked command by itself, with allowed flags only, is the full check', async () => {
  const full: [string, string][] = [
    ['npm test', 'npm test'],
    ['npm run test', 'npm test'],
    ['pytest -q', 'pytest'],
    ['python -m pytest -q', 'pytest'],
    ['pytest -q  # all tests', 'pytest'],
    ['pytest \\\n  -q', 'pytest'],
    ['timeout 600 npm test', 'npm test'],
    ['yarn jest', 'jest'],
    ['bundle exec rspec', 'rspec'],
    ['.venv/bin/pytest -ra --tb=short', 'pytest'],
    ['uv run pytest -s', 'pytest'],
    ['npx vitest run --reporter=dot', 'vitest run'],
    ['npx vitest run --reporter dot', 'vitest run'],
    ['vitest --run', 'vitest'],
    ['npm test -- --watchAll=false --ci', 'npm test'],
    ['npm test 2>&1', 'npm test'],
    ['npx jest --colors --silent', 'jest'],
    ['pytest -m unit -q', 'pytest -m unit'],
  ]
  for (const [command, verdict] of full) {
    expect(`${command} ${runKind(command, verdict)}`).toBe(`${command} full`)
  }
})

test('runKind: an extra flag, word or variable in front is not the full check', async () => {
  const extra: [string, string][] = [
    ['pytest --version', 'pytest'],
    ['npm test --version', 'npm test'],
    ["PYTEST_ADDOPTS='-k x' pytest", 'pytest'],
    ['PYTHONOPTIMIZE=1 pytest', 'pytest'],
    ['CI=true npm test', 'npm test'],
    ['env CI=1 npm test', 'npm test'],
    ['time PYTHONOPTIMIZE=1 pytest', 'pytest'],
    ['sudo PYTEST_ADDOPTS=-kx pytest', 'pytest'],
    ['timeout 600 env CI=1 npm test', 'npm test'],
    ['npm test -v', 'npm test'],
    ['npx jest -v', 'jest'],
    ['npm test -- -v', 'npm test'],
    ['pytest -v', 'pytest'],
    ['pytest tests/test_a.py', 'pytest'],
    ['pytest -k x', 'pytest'],
    ['pytest -x', 'pytest'],
    ['pytest .', 'pytest'],
    ['npm test -- auth', 'npm test'],
    ['go test ./... -run=TestA', 'go test ./...'],
    ['go test ./... -count=1', 'go test ./...'],
    ['npx vitest run --coverage', 'vitest run'],
  ]
  for (const [command, verdict] of extra) {
    expect(`${command} ${runKind(command, verdict)}`).toBe(`${command} extra`)
  }
  // the locked command carries its own flags: a run without them is another command
  expect(runKind('pytest', 'pytest -m unit')).toBeUndefined()
})

test('runKind: in a pipe or a chain it is "chained"; another command is none of these', async () => {
  for (const command of ['npm test | tail -5', 'cd api && npm test', 'npm test; echo $?', 'npm test || true']) {
    expect(`${command} ${runKind(command, 'npm test')}`).toBe(`${command} chained`)
  }
  for (const command of ['npm run lint', 'python -m unittest', 'echo npm test', 'ls']) {
    expect(`${command} ${runKind(command, 'npm test')}`).toBe(`${command} undefined`)
  }
})

test('cannotCheck: a command that runs no check cannot be the full check', async () => {
  for (const command of ['pytest --version', 'npm test -- --help', 'pytest -h', 'pytest --collect-only', 'pytest --co', 'npx jest --listTests', 'cargo test --list', 'npm test -- --dry-run', 'npx jest --passWithNoTests']) {
    expect(`${command} ${cannotCheck(command) !== undefined}`).toBe(`${command} true`)
  }
  expect(cannotCheck('pytest --version')).toBe('--version')
  expect(cannotCheck('pytest -q')).toBeUndefined()
  expect(cannotCheck('pytest -k "--help"')).toBeUndefined()
})

test('masked: a command as receipts keep it: no value set in front, no quoted text', async () => {
  expect(masked("API_KEY=sk-123 PYTEST_ADDOPTS='-k x' pytest -q")).toBe('API_KEY=… PYTEST_ADDOPTS=… pytest -q')
  expect(masked('pytest -k "secret thing" && env TOKEN=abc npm test')).toBe('pytest -k "…" && env TOKEN=… npm test')
  expect(masked('cat <<EOF > x\npassword\nEOF')).not.toContain('password')
  expect(masked('npm test')).toBe('npm test')
})

// ---- the verdict line: the newest full run, and the project as it is now ----

test('the verdict line: a full run stands while the project is as it was when that run started', async () => {
  expect(line([])).toMatchObject({ pass: false, plain: 'The tests were never run', detail: 'npm test: not run since Lie Eater started watching' })
  expect(line([edit(1), [run(2), P]])).toMatchObject({ pass: true, plain: 'The tests really pass', detail: 'npm test, #2' })
  expect(line([[run(1), P]], 'print-2')).toMatchObject({
    pass: false,
    plain: 'The project changed after the last full check',
    detail: 'npm test, #1, then the project changed',
  })
  expect(line([[run(1, 'failed'), P]])).toMatchObject({ pass: false, plain: 'The tests fail', detail: 'npm test, #1' })
  expect(line([[run(1, 'unknown'), P]])).toMatchObject({ unclear: true, plain: 'The result of the test run could not be read' })
  // a run with no fingerprint (the walk failed) is never fresh
  expect(line([run(1)])).toMatchObject({ plain: 'The project changed after the last full check' })
})

test('the verdict line: a project not read fully is never better than "not checked"', async () => {
  expect(rule(play([[run(1), P]]), [], undefined)[0]).toMatchObject({ pass: false, unclear: true, plain: 'The project could not be read fully' })
  const { print: _armed, ...tooBig } = play([[run(1), P]])
  expect(rule(tooBig, [], P)[0]).toMatchObject({ unclear: true, plain: 'The project could not be read fully' })
})

test('the verdict line: a newer run that is not the full check says why "done" cannot be checked', async () => {
  const at = (id: number, target: string) => rec({ id, kind: 'test', target })

  expect(line([at(1, 'npm test -k x')])).toMatchObject({
    unclear: true,
    plain: 'The full check was run with extra options',
    detail: 'npm test -k x (#1) is not the full check. Run `npm test` exactly, by itself.',
  })
  expect(line([at(1, 'npm test | tail -5')])).toMatchObject({ unclear: true, plain: 'The tests were not run by themselves' })
  expect(line([edit(1), at(2, 'cd api && python -m unittest 2>&1 | tail -3')])).toMatchObject({
    plain: 'Another test command was run',
    detail: 'full check: npm test · ran: python -m unittest (#2). If that is the right one, type /check python -m unittest',
  })
  // a fresh full run stands; an older try changes nothing
  expect(line([at(1, 'npm test -- auth'), [run(2), P], at(3, 'npm test | tail -3')])?.pass).toBe(true)
  // the masked command, never a value set in front
  expect(line([at(1, 'API_KEY=sk-1 npm test')])?.detail).toBe('API_KEY=… npm test (#1) is not the full check. Run `npm test` exactly, by itself.')
})

test('records that arrive out of order do not move the watch backwards', async () => {
  expect(line([[run(5), P], [run(4, 'failed'), P]])?.pass).toBe(true)
})

test('a failed edit is no edit; a subagent\'s run of the full check counts', async () => {
  const failedEdit = rec({ id: 2, tool: 'Edit', kind: 'edit', target: 'src/a.ts', state: 'failed' })

  expect(play([failedEdit]).lastEdit).toBe(0)
  expect(play([edit(2)]).lastEdit).toBe(2)
  expect(line([edit(1), [run(2, 'clean', { agentId: 'a1' }), P]])?.pass).toBe(true)
})

test('the script behind `npm test` is the full check too, only when it is one command', async () => {
  const armed = { ...armWatch('npm test', { id: 1, at: 0 }, [], 'vitest run'), print: P }
  expect(armed.also).toBe('vitest run')
  expect(rule(track(armed, rec({ id: 1, kind: 'test', target: 'npx vitest run' }), P), [], P)[0]).toMatchObject({ pass: true, detail: 'npm test, #1' })
  expect(armWatch('npm test', { id: 1, at: 0 }, [], 'echo ok').also).toBeUndefined()
  // a part of a longer script is no full check
  for (const script of ['vitest run && node --test', 'tsc --noEmit && vitest run', 'vitest run; node --test', 'vitest run || true', 'vitest run | tee out.txt', 'vitest run\nnode --test']) {
    expect(`${script}: ${armWatch('npm test', { id: 1, at: 0 }, [], script).also}`).toBe(`${script}: undefined`)
  }
})

test('npm, pnpm and yarn run the same test script, and so does `bun run test`: the same full check', async () => {
  for (const ran of ['pnpm test', 'yarn test', 'npm run test', 'pnpm run test', 'yarn run test', 'bun run test']) {
    expect(`${ran}: ${runKind(ran, 'npm test')}`).toBe(`${ran}: full`)
  }
  expect(runKind('npm test', 'pnpm test')).toBe('full')
  expect(runKind('pnpm test -- -t cart', 'npm test')).toBe('extra')
})

test('a run in another folder is not the full check: "ran in another folder"', async () => {
  const t = track({ ...armWatch('npm test', { id: 1, at: 0 }, []), print: P }, run(1), P, true)
  expect(t.fullRun).toBeUndefined()
  expect(rule(t, [], P)[0]).toMatchObject({ pass: false, unclear: true, plain: 'The full check ran in another folder' })
})

test('isPlainRun: a test run seen before the watch can lock it only when it would be the full check by itself', async () => {
  for (const command of ['pytest', 'pytest -q', 'python -m pytest', 'uv run pytest', 'npm test', 'npx vitest run', 'go test ./...', 'cargo test', 'node --test', 'make test']) {
    expect(`${command}: ${isPlainRun(command)}`).toBe(`${command}: true`)
  }
  for (const command of ['pytest -k smoke', 'pytest tests/test_a.py', 'CI=1 npm test', 'npm test -- -t cart', 'pytest | tail -5', 'pytest --collect-only', 'echo ok', 'pytest -k "a or b"', 'python cart.py']) {
    expect(`${command}: ${isPlainRun(command)}`).toBe(`${command}: false`)
  }
})

test('a failing full check before any change of the project is the baseline: the checks were already failing', async () => {
  const counts = { passed: 31, failed: 3 }
  const failing = (id: number) => run(id, 'failed', { counts })

  // the first failing run started on the project as it was armed
  expect(line([[failing(1), P], edit(2), [failing(3), 'print-2']], 'print-2')?.plain).toBe(
    'The tests still fail, as they did before the AI started',
  )
  // after a change a failing run is no baseline
  expect(line([edit(1), [failing(2), 'print-2']], 'print-2')?.plain).toBe('The tests fail')
})

// ---- the lines of the check files ----

const changes: Change[] = [
  { file: 'tests/b.test.ts', how: 'changed', n: 3, lost: ['  expect(x).toBe(3)'] },
  { file: 'package.json', how: 'config' },
  { file: 'tests/a.test.ts', how: 'gone' },
]

test('each changed check file is a line', async () => {
  const lines = rule(play([[run(1), P]]), changes, P)

  expect(lines.slice(1)).toEqual([
    expect.objectContaining({ term: 'changed', pass: false, plain: 'The AI changed 3 lines in a check file', detail: 'tests/b.test.ts: 3 lines changed', file: 'tests/b.test.ts', n: 3 }),
    expect.objectContaining({ term: 'config', pass: false, plain: 'The AI changed how the checks run', detail: 'package.json changed', file: 'package.json' }),
    expect.objectContaining({ term: 'gone', pass: false, plain: 'The AI moved or deleted a check file', detail: 'tests/a.test.ts is gone', file: 'tests/a.test.ts' }),
  ])
  // the lines that are gone are never part of a line: they are for the pane only
  expect(JSON.stringify(lines)).not.toContain('toBe(3)')
})

test('every broken line says why it matters; a kept line does not', async () => {
  for (const l of rule(play([]), changes, P)) {
    expect(`${l.term} ${l.why !== undefined}`).toBe(`${l.term} ${!l.pass}`)
  }
})

test('plainCommand: where the output goes is not part of the command', async () => {
  expect(plainCommand('npm test > out.txt 2>&1')).toBe('npm test')
  expect(plainCommand('pytest -q 2>/dev/null | tail -5')).toBe('pytest -q')
  expect(plainCommand('npm test &> /dev/null')).toBe('npm test')
  expect(plainCommand('cd api && npm test 2>&1 | tail -20')).toBe('npm test')
  expect(plainCommand('pytest -k "a > b"')).toBe('pytest -k "a > b"')
  expect(plainCommand('pytest -q  # all tests')).toBe('pytest -q')
  expect(plainCommand('pytest \\\n  -q')).toBe('pytest -q')
  expect(plainCommand('cd api\nnpm test')).toBe('cd api; npm test')
})

// ---- the third review round (20 Nov, GPT 6.2) ----

test('the script behind `npm test` is the same run only when nothing else runs with it', async () => {
  expect(packageShortcut('{"scripts":{"test":"vitest run"}}')).toBe('vitest run')
  // a pretest or posttest script runs with `npm test`, not with `npx vitest run`
  expect(packageShortcut('{"scripts":{"test":"vitest run","pretest":"node --test"}}')).toBeUndefined()
  expect(packageShortcut('{"scripts":{"test":"vitest run","posttest":"node check.js"}}')).toBeUndefined()
  // a value set in front of the script is part of the run
  expect(packageShortcut('{"scripts":{"test":"CI=1 vitest run"}}')).toBeUndefined()
  expect(packageShortcut('{"scripts":{"test":"vitest run && node --test"}}')).toBeUndefined()
})

test('`bun test` is Bun\'s own runner, not the test script; `bun run test` is the script', async () => {
  expect(runKind('pnpm test', 'npm test')).toBe('full')
  expect(runKind('yarn run test', 'npm test')).toBe('full')
  expect(runKind('bun run test', 'npm test')).toBe('full')
  expect(runKind('bun test', 'npm test')).toBeUndefined()
  expect(runKind('npm test', 'bun test')).toBeUndefined()
  expect(alsoOf('bun test', 'vitest run')).toBeUndefined()
})

test('a chain cannot be named as the full check: only its first command would be matched', async () => {
  expect(cannotCheck('vitest run && node --test')).toBe('&&')
  expect(cannotCheck('pytest; echo ok')).toBe(';')
  expect(cannotCheck('pytest | tail')).toBe('|')
  expect(cannotCheck('pytest -q')).toBeUndefined()
})

// The rating round (20 Nov, GPT 6.2): a value set through a wrapper is part of the script's run too.
test('the script shortcut does not hold when the script sets a value through `env` or `cross-env`', async () => {
  for (const script of ['env CI=1 vitest run', 'cross-env NODE_ENV=test vitest run', 'npx cross-env CI=1 jest']) {
    expect(`${script}: ${packageShortcut(JSON.stringify({ scripts: { test: script } }))}`).toBe(`${script}: undefined`)
  }
  // a flag with a value is no value set for the run
  expect(packageShortcut('{"scripts":{"test":"vitest run --reporter=dot"}}')).toBe('vitest run --reporter=dot')
})
