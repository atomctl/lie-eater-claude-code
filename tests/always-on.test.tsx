import { expect, test } from 'claude-code/testing'

import { DEMO_ENDS, DEMO_HINT, DEMO_INTRO, DEMO_PROMPT, demoEnd } from '../hooks/lib/demo'
import { MATH, PANE, bash, betRun, detailLines, done, editCode, editFile, endTurn, paneLines, project, prompt, run, start, world } from './kit'

const failing = () => ({ result: 'Exit code 1', isError: true as const, text: 'Exit code 1\n3 failed, 31 passed in 2.10s' })
const passing = () => ({ result: {}, text: '34 passed in 1s' })
const has = (lines: string[], text: string) => lines.some(l => l.includes(text))
const status = (seen: { status: (string | undefined)[] }) => seen.status.at(-1)
const quiet = { toasts: [], opens: 0, sounds: 0 }
const SKIPPED = MATH.replace("it('adds'", "it.skip('adds'")
const GUTTED = "it('adds', () => {\n  expect(add(1, 2)).toBe(3)\n})\n"
const RED = '✗ don\'t trust "done"'
const PASSED = 'The checks passed after the last change. No existing check file was changed.'
const NO_NEW = 'The AI added no new check for this change.'
const ADD_ONE = 'If this change added or changed behaviour, add a check for it in a new file and call done again.'

test('a session of questions only: the line says "watching", and nothing fires', async ($, on) => {
  const seen = world(on, project())
  on('tool.call', passing)

  await start($)
  await prompt($, 'What does this project do?')
  await $.tool.call({ tool: 'Read', file_path: 'src/a.ts' })
  await endTurn($, 'It adds numbers.')

  expect(status(seen)).toBe('Lie Eater · watching')
  expect(seen).toMatchObject({ ...quiet, prompts: [{ text: 'What does this project do?', asUser: false }] })
  expect(await paneLines($)).toContain(
    'When the AI says "done", Lie Eater checks the proof: the checks must pass, and none may be removed or switched off.',
  )
})

test('a small job with no test run and a done call: "not checked", and nothing else', async ($, on) => {
  const seen = world(on, project())
  on('tool.call', passing)

  await start($)
  await editCode($)
  expect(status(seen)).toBe('Lie Eater ? not checked')
  const reply = String((await done($)).result)

  expect(reply.split('\n').slice(0, 2)).toEqual(['? not checked', 'The full check was not run after the last change.'])
  expect(reply).toContain('Run the full check `npm test` by itself')
  expect(status(seen)).toBe('Lie Eater ? not checked')
  expect(seen).toMatchObject(quiet)
})

test('honest work with a passing full check: "checked", silently; the AI hears it', async ($, on) => {
  const seen = world(on, project())
  on('tool.call', passing)

  await start($)
  await editCode($)
  await betRun($, 'npm test')
  const reply = String((await done($)).result)

  expect(reply.split('\n').slice(0, 3)).toEqual(['✓ checked', PASSED, NO_NEW])
  expect(status(seen)).toBe('Lie Eater ✓ checked · no new check')
  expect(seen).toMatchObject(quiet)
})

test('the AI adds new checks in a new file: "checked"; they are watched from then on', async ($, on) => {
  const opts = project()
  const seen = world(on, opts)
  on('tool.call', passing)

  await start($)
  await $.tool.call({ tool: 'Write', file_path: 'tests/more.test.ts', content: '…' })
  opts.files['more.test.ts'] = "it('divides', () => {\n  expect(div(6, 3)).toBe(2)\n})\n"
  opts.dirs?.tests?.push('more.test.ts')
  await betRun($, 'npm test')
  expect(String((await done($)).result).split('\n')[0]).toBe('✓ checked')

  // the new file is part of the watch now: switching it off later is seen
  opts.files['more.test.ts'] = "it.skip('divides', () => {\n  expect(div(6, 3)).toBe(2)\n})\n"
  await editCode($, 'tests/more.test.ts')
  await betRun($, 'npm test')
  expect(String((await done($)).result).split('\n')[1]).toBe('The AI changed 1 line in the check file tests/more.test.ts.')
  expect(seen.toasts).toEqual([RED])
})

// ---- two kinds of green: did the AI add a check for its work? ----

/** The AI writes a new file in the tests folder. */
const addTestFile = (opts: ReturnType<typeof project>, name: string, text = "it('taxes', () => {\n  expect(tax(10)).toBe(2)\n})\n") => {
  opts.files[name] = text
  opts.dirs.tests.push(name)
}

test('green with a new check file: the third line names it, the status line is plain, and nothing is advised', async ($, on) => {
  const opts = project()
  const seen = world(on, opts)
  on('tool.call', passing)

  await start($)
  await editFile($, opts.files)
  addTestFile(opts, 'tax.test.ts')
  await betRun($, 'npm test')
  const reply = String((await done($)).result)

  expect(reply.split('\n').slice(0, 3)).toEqual(['✓ checked', PASSED, 'The AI added new checks: tests/tax.test.ts.'])
  expect(reply).not.toContain(ADD_ONE)
  expect(status(seen)).toBe('Lie Eater ✓ checked')
  expect(seen).toMatchObject(quiet)

  // done again with nothing changed: nothing is new since the re-arm, so this green has no new check
  expect(String((await done($)).result).split('\n').slice(0, 3)).toEqual(['✓ checked', PASSED, NO_NEW])
  expect(status(seen)).toBe('Lie Eater ✓ checked · no new check')

  // armed again: the new file is frozen now, so the next green with only a source change has no new check
  await editFile($, opts.files)
  await betRun($, 'npm test')
  expect(String((await done($)).result).split('\n')[2]).toBe(NO_NEW)
  expect(status(seen)).toBe('Lie Eater ✓ checked · no new check')
})

test('green with only source changed: "no new check", and one plain sentence for the AI; still green, still silent', async ($, on) => {
  const opts = project()
  const seen = world(on, opts)
  on('tool.call', passing)

  await start($)
  await editFile($, opts.files)
  await betRun($, 'npm test')
  const reply = String((await done($)).result).split('\n')

  expect(reply.slice(0, 3)).toEqual(['✓ checked', PASSED, NO_NEW])
  expect(reply.slice(-2)).toEqual(['', ADD_ONE])
  expect(status(seen)).toBe('Lie Eater ✓ checked · no new check')
  expect(seen).toMatchObject(quiet)

  // advice, not a refusal: the watch is armed again, and a check file added now is new to it
  addTestFile(opts, 'tax.test.ts')
  await betRun($, 'npm test')
  expect(String((await done($)).result).split('\n').slice(0, 3)).toEqual(['✓ checked', PASSED, 'The AI added new checks: tests/tax.test.ts.'])
  expect(status(seen)).toBe('Lie Eater ✓ checked')
  expect(seen).toMatchObject(quiet)
})

test('a helper is the only new file in a test folder: it holds no check, so it is no new check', async ($, on) => {
  const opts = project()
  const seen = world(on, opts)
  on('tool.call', passing)

  await start($)
  await editFile($, opts.files)
  addTestFile(opts, 'helpers.ts', 'export const two = 2\n')
  await betRun($, 'npm test')

  expect(String((await done($)).result).split('\n')[2]).toBe('The AI added no new check for this change.')
  expect(status(seen)).toBe('Lie Eater ✓ checked · no new check')
})

test('several new check files: the first by name, and how many more', async ($, on) => {
  const opts = project()
  world(on, opts)
  on('tool.call', passing)

  await start($)
  await editFile($, opts.files)
  for (const name of ['c.test.ts', 'a.test.ts', 'b.test.ts']) addTestFile(opts, name)
  await betRun($, 'npm test')

  expect(String((await done($)).result).split('\n')[2]).toBe('The AI added new checks: tests/a.test.ts and 2 more files.')
})

test('a check put back with git checkout: "checked"', async ($, on) => {
  const opts = project()
  const seen = world(on, opts)
  on('tool.call', passing)

  await start($)
  opts.files['math.test.ts'] = GUTTED
  await editCode($, 'tests/math.test.ts')
  await betRun($, 'npm test')
  expect(String((await done($)).result).split('\n')[1]).toBe('The AI changed 4 lines in the check file tests/math.test.ts.')

  await bash($, 'git checkout -- tests/math.test.ts')
  opts.files['math.test.ts'] = MATH
  await betRun($, 'npm test')

  expect(String((await done($)).result).split('\n')[0]).toBe('✓ checked')
  expect(status(seen)).toBe('Lie Eater ✓ checked · no new check')
})

test('a project with no checks: "no checks yet"; once checks exist, Lie Eater arms itself', async ($, on) => {
  const files: Record<string, string> = {}
  const dirs = { tests: [] as string[] }
  const seen = world(on, { files, dirs })
  on('tool.call', passing)

  await start($)
  expect(status(seen)).toBe('Lie Eater ? no checks yet')
  expect(await paneLines($)).toEqual(expect.arrayContaining(['? not checked', 'This project has no checks yet.']))
  await editCode($)
  expect(String((await done($)).result)).toBe('Lie Eater: this project has no checks yet, so "done" cannot be checked.')
  expect(status(seen)).toBe('Lie Eater ? no checks yet')

  // the AI adds a test setup and tests
  files['package.json'] = '{"scripts":{"test":"vitest run"}}'
  files['math.test.ts'] = MATH
  dirs.tests.push('math.test.ts')
  await betRun($, 'npm test')
  // the work before the checks is not certified: Lie Eater watches from now on
  expect(String((await done($)).result)).toBe(
    'Lie Eater found the checks (`npm test`) and watches from now on. The work done before this is not checked.',
  )
  expect(status(seen)).toBe('Lie Eater · watching')
  expect(seen).toMatchObject(quiet)
})

test('a project with no checks arms itself at the next prompt too', async ($, on) => {
  const files: Record<string, string> = {}
  const dirs = { tests: [] as string[] }
  const seen = world(on, { files, dirs })

  await start($)
  files['pyproject.toml'] = '[project]'
  files['test_cart.py'] = 'def test_total():\n    assert total([]) == 0\n'
  dirs.tests.push('test_cart.py')
  await prompt($)

  expect(status(seen)).toBe('Lie Eater · watching')
})

test('a code change after a green result: "not checked" again, silently', async ($, on) => {
  const seen = world(on, project())
  on('tool.call', passing)

  await start($)
  await editCode($)
  await betRun($, 'npm test')
  await done($)
  expect(status(seen)).toBe('Lie Eater ✓ checked · no new check')

  await editCode($)
  expect(status(seen)).toBe('Lie Eater ? not checked')
  expect(seen).toMatchObject(quiet)
})

test('green, then done again with no change: still "checked"', async ($, on) => {
  const seen = world(on, project())
  on('tool.call', passing)

  await start($)
  await editCode($)
  await betRun($, 'npm test')
  await done($)
  await prompt($, 'Thanks. Anything else?')

  expect(String((await done($)).result).split('\n')[0]).toBe('✓ checked')
  expect(status(seen)).toBe('Lie Eater ✓ checked · no new check')
})

test('a run with extra options after a change proves nothing new: "not checked", with the plain command', async ($, on) => {
  const opts = project()
  const seen = world(on, opts)
  on('tool.call', passing)

  await start($)
  await editCode($)
  await betRun($, 'npm test')
  await done($)
  await editCode($)
  opts.files['a.ts'] = 'export const a = 2\n'
  await betRun($, 'npm test -- auth')
  const reply = String((await done($)).result)

  // the newest full run is older than the change: no proof either way, never "don't trust"
  expect(reply.split('\n').slice(0, 2)).toEqual(['? not checked', 'The full check was run with extra options. Run it plain.'])
  expect(reply).toContain('Run `npm test` exactly, by itself.')
  expect(seen).toMatchObject(quiet)
})

test('two red results in a row: one toast, one sound; the pane is opened at each', async ($, on) => {
  const opts = project()
  const seen = world(on, opts)
  on('tool.call', passing)

  await start($)
  opts.files['math.test.ts'] = SKIPPED
  await editCode($, 'tests/math.test.ts')
  await betRun($, 'npm test')
  const first = String((await done($)).result)
  await done($)

  expect(first.split('\n').slice(0, 3)).toEqual([RED, 'The AI changed 1 line in the check file tests/math.test.ts.', 'The AI did not say so.'])
  expect(seen).toMatchObject({ toasts: [RED], opens: 2, sounds: 1 })
  expect(status(seen)).toBe(`Lie Eater ${RED}`)
  const lines = await detailLines($)
  expect(lines.slice(0, 3)).toEqual([RED, 'The AI changed 1 line in the check file tests/math.test.ts.', 'The AI did not say so.'])
  expect(has(lines, 'Details')).toBe(true)
  expect(has(lines, 'tests/math.test.ts: 1 line changed')).toBe(true)
  // the lines that are gone show in the pane, and nowhere else
  expect(lines).toEqual(expect.arrayContaining(['Gone from tests/math.test.ts:', "    it('adds', () => {"]))
  expect(first).not.toContain("it('adds'")
})

test('a red result the AI named: "The AI said so itself"', async ($, on) => {
  const opts = project()
  const seen = world(on, opts)
  on('tool.call', (_, e) => (e.tool === 'Bash' ? failing() : passing()))

  await start($)
  await editFile($, opts.files)
  await betRun($, 'npm test', 'fail')
  const reply = String((await done($, 'One test still fails: the parser does not read dates.')).result)

  expect(reply.split('\n').slice(0, 3)).toEqual([RED, 'The checks fail.', 'The AI said so itself.'])
  expect(reply).toContain('1. Make `npm test` pass by fixing the code.')
  expect(seen.toasts).toEqual([RED])
})

test('a reload does not take a new snapshot: a check removed before it is still seen', async ($, on) => {
  const opts = project()
  world(on, opts)
  on('tool.call', passing)

  await start($)
  opts.files['math.test.ts'] = GUTTED
  await editCode($, 'tests/math.test.ts')
  await start($)
  await betRun($, 'npm test')

  expect(String((await done($)).result).split('\n')[1]).toBe('The AI changed 4 lines in the check file tests/math.test.ts.')
})

test('the AI runs another test runner than the guessed one: "not checked", never "don\'t trust"', async ($, on) => {
  const seen = world(on, { files: { 'pyproject.toml': '[project]', 'test_cart.py': 'def test_total():\n    assert total([]) == 0\n' }, dirs: { tests: ['test_cart.py'] } })
  on('tool.call', () => ({ result: {}, text: 'Ran 3 tests in 0.01s\n\nOK' }))

  await start($)
  await editCode($, 'cart.py')
  await betRun($, 'python -m unittest')
  const reply = String((await done($)).result)

  expect(reply.split('\n').slice(0, 2)).toEqual(['? not checked', 'The full check was not run after the last change.'])
  expect(reply).toContain('full check: pytest · ran: python -m unittest')
  expect(seen).toMatchObject(quiet)
})

test('checks that already failed before any change: "not checked", never "don\'t trust"', async ($, on) => {
  const opts = project()
  const seen = world(on, opts)
  on('tool.call', (_, e) => (e.tool === 'Bash' ? failing() : passing()))

  await start($)
  await betRun($, 'npm test', 'fail')
  await editCode($, 'src/feature.ts')
  opts.files['a.ts'] = 'export const a = 2\n'
  await betRun($, 'npm test', 'fail')
  const reply = String((await done($)).result)

  expect(reply.split('\n').slice(0, 2)).toEqual(['? not checked', 'The checks were already failing before the AI started.'])
  expect(seen).toMatchObject(quiet)
})

test('a run inside a longer command: "not checked"', async ($, on) => {
  const seen = world(on, { ...project(), files: { 'pyproject.toml': '[project]', 'test_cart.py': 'def test_a():\n    assert 1\n' }, dirs: { tests: ['test_cart.py'] } })
  on('tool.call', passing)

  await start($)
  await editCode($, 'cart.py')
  await betRun($, 'pytest -q 2>&1 | tail -20')

  expect(String((await done($)).result).split('\n').slice(0, 2)).toEqual([
    '? not checked',
    'The check ran inside a longer command, so its result cannot be trusted.',
  ])
  expect(seen).toMatchObject(quiet)
})

test("a subagent's done call is not checked", async ($, on) => {
  const seen = world(on, project())
  on('tool.call', failing)

  await start($)
  await editCode($)
  await betRun($, 'npm test', 'fail')

  expect(await done($, undefined, { agentId: 'a1' })).toMatchObject({ result: 'Lie Eater checks only the main AI\'s done call.' })
  expect(seen).toMatchObject(quiet)
})

// ---- the commands and the buttons ----

test('/check sends the AI to repair and run the full check, as the person, three times per watch', async ($, on) => {
  const opts = project()
  const seen = world(on, opts)
  on('tool.call', passing)

  await start($)
  opts.files['math.test.ts'] = SKIPPED
  await editCode($, 'tests/math.test.ts')
  await betRun($, 'npm test')
  await done($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'repair' })).toBeDefined()
  expect(await ui.find({ key: 'accept' })).toBeDefined()
  await ui.press({ key: 'repair' })
  await ui.unmount()
  await seen.tick()

  expect(seen.prompts).toEqual([
    {
      text: [
        'Lie Eater found this. Repair it, then run `npm test` by itself:',
        '1. Put the check file tests/math.test.ts back as it was.',
        'Existing check files are frozen. Put new checks in a new file. If an existing check must change, say why in `broken`: the person decides.',
        'Fix the code, not the tests.',
        'Then call the done tool.',
      ].join('\n'),
      asUser: true,
    },
  ])
  expect((await run($, 'check')).text).toBe('Lie Eater sent the AI back to repair what it found and to run the full check (`npm test`).')
  await run($, 'check')
  expect((await run($, 'check')).text).toBe(
    'Lie Eater has sent the AI back 3 times. Look at the Details with /lie-eater details, or type /accept if the change is right.',
  )
  await seen.tick()
  expect(seen.prompts).toHaveLength(3)
})

test('/check with nothing to repair asks for one run of the full check', async ($, on) => {
  const seen = world(on, project())
  on('tool.call', passing)

  await start($)
  await editCode($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'check' })
  await ui.unmount()
  await seen.tick()

  expect(seen.prompts).toEqual([
    {
      text: 'Run the full check `npm test` by itself, with no pipe and no other command beside it, and wait for its result. Then call the done tool.',
      asUser: true,
    },
  ])
  expect((await run($, 'check')).text).toBe('Lie Eater asked the AI to run the full check (`npm test`) by itself.')
})

test('/check in a project with no checks asks the AI to add them; they protect the work from then on', async ($, on) => {
  const seen = world(on)

  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'add' })).toBeDefined()
  await ui.unmount()

  expect((await run($, 'check')).text).toBe(
    'Lie Eater asked the AI to add checks. They protect the work from now on; the work done before them is not checked.',
  )
  await seen.tick()
  expect(seen.prompts).toEqual([
    {
      text: 'This project has no tests. Add a small test setup with a test command, and 3 to 5 tests for the most important behaviour. Then say which command runs them.',
      asUser: true,
    },
  ])
})

test('/check <command>: the person names the full check; what was there before stays the baseline', async ($, on) => {
  const opts = project()
  const seen = world(on, opts)
  on('tool.call', passing)

  await start($)
  opts.files['math.test.ts'] = GUTTED
  await editCode($, 'tests/math.test.ts')
  expect((await run($, 'check', 'pnpm test')).text).toBe(
    'Lie Eater sent the AI back to repair what it found and to run the full check (`pnpm test`).',
  )
  await seen.tick()
  expect(seen.prompts.at(-1)?.text).toContain('then run `pnpm test` by itself')
  await betRun($, 'pnpm test')

  expect(String((await done($)).result).split('\n').slice(0, 2)).toEqual([RED, 'The AI changed 4 lines in the check file tests/math.test.ts.'])
})

test('/check <command> arms a project in which Lie Eater found no checks', async ($, on) => {
  const seen = world(on)
  on('tool.call', passing)

  await start($)
  await run($, 'check', 'make ci')
  expect(status(seen)).toBe('Lie Eater · watching')
  await editCode($)
  await betRun($, 'make ci')
  expect(String((await done($)).result).split('\n')[0]).toBe('✓ checked')
})

test('/accept: the files are frozen as they are, and "not checked" until a new full check passes', async ($, on) => {
  const opts = project()
  const seen = world(on, opts)
  on('tool.call', passing)

  await start($)
  expect((await run($, 'accept')).text).toBe('Nothing to accept.')
  opts.files['math.test.ts'] = GUTTED
  await editCode($, 'tests/math.test.ts')
  await betRun($, 'npm test')
  await done($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'accept' })
  await ui.unmount()

  // the full run before the accepted change no longer stands
  expect(status(seen)).toBe('Lie Eater ? not checked')
  expect((await run($, 'accept')).text).toBe('Nothing to accept.')
  await prompt($)
  expect(String((await done($)).result).split('\n').slice(0, 2)).toEqual(['? not checked', 'The full check was not run after the last change.'])
  await betRun($, 'npm test')
  expect(String((await done($)).result).split('\n')[0]).toBe('✓ checked')
  expect(status(seen)).toBe('Lie Eater ✓ checked · no new check')
  // a red result after an accepted one is new: it is shown again
  opts.files['math.test.ts'] = GUTTED.replace("it('adds'", "it.skip('adds'")
  await done($)
  expect(seen.toasts).toEqual([RED, RED])
})

test('/accept by command does the same as the button', async ($, on) => {
  const opts = project()
  const seen = world(on, opts)
  on('tool.call', passing)

  await start($)
  opts.files['math.test.ts'] = GUTTED
  await editCode($, 'tests/math.test.ts')
  await betRun($, 'npm test')
  await done($)

  expect((await run($, 'accept')).text).toBe('You accepted the change. Lie Eater watches from the files as they are now.')
  expect(status(seen)).toBe('Lie Eater ? not checked')
})

test('/lie-eater opens the pane', async ($, on) => {
  const seen = world(on, project())

  await start($)
  expect((await run($, 'lie-eater')).text).toBe('Lie Eater pane opened.')
  expect(seen.opens).toBe(1)
})

// ---- the words ----

const BANNED = /\b(game|rules?|ruling|verdict|referee|summon|debt)\b|LIE EATEN|call \d|\(\^_\^\)|\(-_-\)|\(o_o\)|No\. \d/i

test('the person never reads the old words: not in the pane, a toast, the status line or a command', async ($, on) => {
  const opts = project()
  const seen = world(on, opts)
  let isGreen = false
  on('tool.call', () => (isGreen ? passing() : failing()))
  const shown: string[] = []
  // the whole pane: the result, the buttons, the hint, and Details shown
  const look = async () => shown.push(...(await paneLines($)), ...(await detailLines($)))

  await start($)
  await look()
  await editCode($)
  await look()
  await betRun($, 'npm test', 'fail')
  await done($)
  await look()
  shown.push(String((await run($, 'check')).text), String((await run($, 'call', 'pass')).text))
  opts.files['math.test.ts'] = SKIPPED
  await done($)
  await look()
  shown.push(String((await run($, 'accept')).text))
  isGreen = true
  await editCode($)
  await betRun($, 'npm test | tail -3')
  await done($)
  await look()
  await betRun($, 'npm test')
  await done($)
  await look()
  await seen.tick()
  shown.push(...seen.toasts, ...seen.status.map(String), ...seen.prompts.map(p => p.text), String((await run($, 'lie-eater', 'demo')).text))
  await seen.tick()
  shown.push(...seen.prompts.map(p => p.text))

  shown.push(...DEMO_INTRO, DEMO_PROMPT, DEMO_HINT, ...Object.values(DEMO_ENDS), ...(demoEnd([]) ?? []))
  expect(shown.filter(line => BANNED.test(line))).toEqual([])
  expect(seen.status.every(line => !/green|yellow|red/.test(String(line)))).toBe(true)
})
