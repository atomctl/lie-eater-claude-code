import { expect, test } from 'claude-code/testing'

import { DONE, NOT_DONE, bash, bet, betRun, endTurn, paneLines, paneWhen, run, world } from './kit'

const failing = () => ({ result: 'Exit code 1', isError: true as const, text: 'Exit code 1\n3 failed, 31 passed' })
const passing = () => ({ result: {}, text: '34 passed in 1s' })
const has = (lines: string[], text: string) => lines.some(l => l.includes(text))

test('with no referee the mod only records', async ($, on) => {
  const seen = world(on, { label: () => DONE })
  on('tool.call', failing)

  await bash($, 'npm test')
  await endTurn($, 'All tests pass. Done.')

  expect(seen).toMatchObject({ opens: 0, classified: 0, sounds: 0, toasts: [] })
  expect(has(await paneLines($), 'No referee is present.')).toBe(true)
  expect(has(await paneLines($), 'RULING')).toBe(false)
})

test('/summon locks the rules, opens the pane and plays the sound', async ($, on) => {
  const seen = world(on)

  const out = await run($, 'summon', 'npm test')

  expect(out.text).toContain('The referee is present. The rules are locked.')
  expect(out.text).toContain('1. The tests must really pass (npm test)')
  expect(out.text).toContain('The game ends by itself when the rules are kept. /rule ends it now.')
  expect(seen).toMatchObject({ opens: 1, sounds: 1, toasts: ['The referee is present. The rules are locked.'] })
  expect(seen.status.at(-1)).toBe('Referee present')

  const lines = await paneLines($)
  expect(has(lines, 'THE REFEREE IS PRESENT')).toBe(true)
  expect(has(lines, '4. No test may be switched off')).toBe(true)
})

test('/summon finds the test command by itself', async ($, on) => {
  world(on, { files: { 'package.json': '{"scripts":{"test":"vitest run"}}' } })
  on('tool.call', passing)

  expect((await run($, 'summon')).text).toContain('(npm test)')
  expect((await run($, 'summon')).text).toBe('A referee is already present. /rule ends the game.')
})

test('/summon takes the newest plain test run of the session before the files', async ($, on) => {
  world(on, { files: { 'package.json': '{"scripts":{"test":"vitest run"}}' } })
  on('tool.call', passing)

  await bash($, 'pytest -q')
  await bash($, 'cd api && pytest -q -k auth || true')

  expect((await run($, 'summon')).text).toContain('(pytest -q)')
})

test('/summon with no tests in sight offers to have the first tests written', async ($, on) => {
  const seen = world(on)

  expect((await run($, 'summon')).text).toBe(
    'I found no tests in this project. Type /summon tests and I ask the AI to write your first tests. Or tell me how you run them, for example: /summon npm test',
  )
  expect((await run($, 'summon', 'tests')).text).toBe(
    'The referee asked the AI for your first tests. Type /summon when they exist.',
  )
  await seen.tick()
  expect(seen.prompts).toEqual([
    {
      text: 'This project has no tests. Add a small test setup with a test command, and 3 to 5 tests for the most important behaviour. Then say which command runs them.',
      asUser: true,
    },
  ])
  expect(has(await paneLines($), 'THE REFEREE IS PRESENT')).toBe(false)
})

test('said done with a failed run: a lie is eaten and the game goes on', async ($, on) => {
  const seen = world(on, { label: () => DONE })
  on('tool.call', failing)

  await run($, 'summon', 'npm test')
  await betRun($, 'npm test', 'fail')
  await endTurn($, 'All tests pass. The work is done.')
  const lines = await paneWhen($, l => has(l, 'RULING'))

  expect(has(lines, '✗ The tests fail')).toBe(true)
  expect(has(lines, 'npm test, call 1')).toBe(true)
  expect(has(lines, 'Why it matters: "Done" without a passing test run is a guess.')).toBe(true)
  expect(has(lines, 'A lie was told. It is eaten.')).toBe(true)
  expect(has(lines, 'VERDICT')).toBe(false)
  expect(has(lines, 'THE REFEREE IS PRESENT')).toBe(true)
  expect(seen.toasts.at(-1)).toBe('LIE EATEN. Rules broken: 1.')
  expect(seen.sounds).toBe(2)
})

test('the turn ends before the model answers', async ($, on) => {
  let release: (label: string) => void = () => {}
  const held = new Promise<string>(resolve => {
    release = resolve
  })
  world(on, { label: () => held })
  on('tool.call', failing)

  await run($, 'summon', 'npm test')
  await betRun($, 'npm test', 'fail')
  const out = await endTurn($, 'All tests pass. The work is done.')

  expect(out).toMatchObject({ text: 'All tests pass. The work is done.' })
  expect(has(await paneLines($), 'RULING')).toBe(false)
  release(DONE)
  expect(has(await paneWhen($, l => has(l, 'RULING')), '✗ The tests fail')).toBe(true)
})

test('said done with the rules kept: the game ends by itself', async ($, on) => {
  const seen = world(on, { label: () => DONE })
  on('tool.call', passing)

  await run($, 'summon', 'npm test')
  await betRun($, 'npm test')
  await endTurn($, 'Fixed. All 34 tests pass.')
  const lines = await paneWhen($, l => has(l, 'VERDICT'))

  expect(has(lines, 'VERDICT: RULES KEPT.')).toBe(true)
  expect(has(lines, 'The rules were kept. The game is over.')).toBe(true)
  expect(has(lines, 'Last game: 1')).toBe(true)
  expect(seen.toasts.at(-1)).toBe('RULES KEPT')
  expect(seen.status.at(-1)).toBeUndefined()
  expect((await run($, 'summon', 'npm test')).text).toContain('The referee is present.')
})

test('not said done: the ruling is shown as "so far", with no toast', async ($, on) => {
  const seen = world(on, { label: () => NOT_DONE })
  on('tool.call', failing)

  await run($, 'summon', 'npm test')
  await betRun($, 'npm test', 'fail')
  await endTurn($, 'One test still fails. Shall I look at the parser?')
  const lines = await paneWhen($, l => has(l, 'RULING'))

  expect(has(lines, 'RULING so far: 3 of 4 rules kept')).toBe(true)
  expect(seen.toasts.some(t => t.startsWith('LIE EATEN') || t === 'RULES KEPT')).toBe(false)
  expect(seen.sounds).toBe(1)
})

test('no answer from the model: "so far", a note, no crash', async ($, on) => {
  world(on, {
    label: () => {
      throw new Error('overloaded')
    },
  })
  on('tool.call', failing)

  await run($, 'summon', 'npm test')
  await betRun($, 'npm test', 'fail')
  await endTurn($, 'All tests pass. The work is done.')
  const lines = await paneWhen($, l => has(l, 'RULING'))

  expect(has(lines, 'RULING so far')).toBe(true)
  expect(has(lines, 'no answer on "said done"')).toBe(true)
})

test('a turn that did not end with an answer, and a subagent turn, get no ruling', async ($, on) => {
  const seen = world(on, { label: () => DONE })
  on('tool.call', failing)

  await run($, 'summon', 'npm test')
  await betRun($, 'npm test', 'fail')
  await endTurn($, 'All tests pass. The work is done.', { reason: 'aborted', isAborted: true })
  await endTurn($, 'All tests pass. The work is done.', { reason: 'error' })
  await endTurn($, 'All tests pass. The work is done.', { agentId: 'a1' })

  expect(seen.classified).toBe(0)
  expect(has(await paneLines($), 'RULING')).toBe(false)
})

test('a number with no source is a note and does not break the game', async ($, on) => {
  world(on, { label: () => DONE })
  on('tool.call', passing)

  await run($, 'summon', 'npm test')
  await betRun($, 'npm test')
  await endTurn($, 'Done. All tests pass and accuracy is now 0.97.')
  const lines = await paneWhen($, l => has(l, 'VERDICT'))

  expect(has(lines, '? 1 number has no source')).toBe(true)
  expect(has(lines, 'in no tool output: 0.97')).toBe(true)
  expect(has(lines, 'VERDICT: RULES KEPT.')).toBe(true)
})

test('/rule ends the game now', async ($, on) => {
  const seen = world(on)
  on('tool.call', failing)

  expect((await run($, 'rule')).text).toBe('No referee is present. Type /summon to call one.')
  await run($, 'summon', 'npm test')
  await betRun($, 'npm test', 'fail')
  const out = await run($, 'rule')

  expect(out.text?.split('\n').at(-3)).toBe('VERDICT: RULES BROKEN. Debt 0 → 1.')
  expect(out.text?.split('\n').at(-1)).toBe('Receipts: .lie-eater/receipts.json')
  expect(out.text).toContain('✗ The tests fail')
  expect(seen.status.at(-1)).toBe('Lie Eater · debt 1')
  expect(has(await paneLines($), 'The rules were broken. The house collects.')).toBe(true)
  expect((await run($, 'rule')).text).toBe('No referee is present. Type /summon to call one.')
})

test('a long session: the ruling does not depend on the 200-call window', async ($, on) => {
  world(on, { label: () => DONE })
  on('tool.call', passing)

  await run($, 'summon', 'npm test')
  await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
  await betRun($, 'npm test')
  for (let i = 0; i < 205; i += 1) {
    await bash($, `ls ${i}`)
  }
  await endTurn($, 'Fixed. The work is done.')
  const lines = await paneWhen($, l => has(l, 'VERDICT'))

  expect(has(lines, '✓ The tests really pass')).toBe(true)
  expect(has(lines, 'npm test, call 2')).toBe(true)
  expect(has(lines, 'VERDICT: RULES KEPT.')).toBe(true)
})

test('a reload in the middle of a game keeps the referee', async ($, on) => {
  const seen = world(on)
  on('tool.call', failing)

  await run($, 'summon', 'npm test')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await betRun($, 'npm test', 'fail')

  expect(seen.status.at(-1)).toBe('Referee present · bets 1/1')
  expect((await run($, 'rule')).text).toContain('npm test, call 1')
})

test('Fix this sends the repair order as the person, three times at most', async ($, on) => {
  const seen = world(on, { label: () => DONE })
  on('tool.call', failing)

  expect((await run($, 'fix')).text).toBe('Nothing to fix.')
  await run($, 'summon', 'npm test')
  await betRun($, 'npm test', 'fail')
  await endTurn($, 'All tests pass. The work is done.')
  await paneWhen($, l => has(l, 'RULING'))

  const ui = await $.ui.mount({ plugin: 'lie-eater', component: 'Pane', requestId: 'lie-eater', surface: 'terminal', props: { title: 'Lie Eater', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } })
  expect(await ui.find({ key: 'fix' })).toBeDefined()
  await ui.press({ key: 'fix' })
  await ui.unmount()
  await seen.tick()

  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]?.asUser).toBe(true)
  expect(seen.prompts[0]?.text.split('\n').slice(0, 2)).toEqual([
    'The referee ruled: rules broken. Repair this, then run `npm test` again:',
    '1. Make `npm test` pass by fixing the code.',
  ])

  expect((await run($, 'fix')).text).toBe(
    'The referee sent the AI back to repair 1 broken rule. If a rule is wrong for this task, type /overrule.',
  )
  await run($, 'fix')
  await seen.tick()
  expect(seen.prompts).toHaveLength(3)
  expect((await run($, 'fix')).text).toBe(
    'The referee has sent the AI back 3 times. Read /explain, or type /overrule if a rule is wrong for this task.',
  )
  await seen.tick()
  expect(seen.prompts).toHaveLength(3)
})

test('Fix this rules again at the press: a repaired rule is not in the order', async ($, on) => {
  const seen = world(on, { label: () => DONE })
  let isFixed = false
  on('tool.call', () => (isFixed ? passing() : failing()))

  await run($, 'summon', 'npm test')
  await betRun($, 'npm test', 'fail')
  await endTurn($, 'All tests pass. The work is done.')
  await paneWhen($, l => has(l, 'RULING'))
  isFixed = true
  await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
  await betRun($, 'npm test')

  expect((await run($, 'fix')).text).toBe('Nothing to fix.')
  expect(seen.prompts).toHaveLength(0)
})

test('/explain says what happened in plain words', async ($, on) => {
  world(on, { label: () => DONE })
  on('tool.call', failing)

  expect((await run($, 'explain')).text).toBe(
    'No game has been ruled yet. Type /summon before you give the AI a task.',
  )
  await run($, 'summon', 'npm test')
  await betRun($, 'npm test', 'fail')
  await endTurn($, 'All tests pass. The work is done.')
  await paneWhen($, l => has(l, 'RULING'))

  expect((await run($, 'explain')).text?.split('\n')).toEqual([
    'The AI said the work was finished, but 1 of the 4 rules was broken.',
    'The tests fail.',
    'Type /fix and the referee sends the AI back to repair it.',
  ])
})

test('/rule while the turn is still being ruled: the final ruling stands, no late lie', async ($, on) => {
  let release: (label: string) => void = () => {}
  const held = new Promise<string>(resolve => {
    release = resolve
  })
  const seen = world(on, { label: () => held })
  on('tool.call', failing)

  await run($, 'summon', 'npm test')
  await betRun($, 'npm test', 'fail')
  await endTurn($, 'All tests pass. The work is done.')
  await run($, 'rule')
  release(DONE)
  for (let i = 0; i < 10; i += 1) await paneLines($)

  const lines = await paneLines($)
  expect(has(lines, 'VERDICT: RULES BROKEN.')).toBe(true)
  expect(has(lines, 'A lie was told')).toBe(false)
  expect(seen.toasts.some(t => t.startsWith('LIE EATEN'))).toBe(false)
  expect(seen.sounds).toBe(1)
})

test('a summon does not wait for the sound, and works with no surface for the pane', async ($, on) => {
  let finishSound: () => void = () => {}
  const seen = world(on, {
    sound: () =>
      new Promise<void>(resolve => {
        finishSound = resolve
      }),
    open: () => {
      throw new Error('no-surface')
    },
  })

  const out = await run($, 'summon', 'npm test')

  expect(out.text).toContain('The referee is present. The rules are locked.')
  expect(seen.status.at(-1)).toBe('Referee present')
  finishSound()
})

// ---- from the review of days 1 and 2 ----

test('"done" after a turn with no work is not a lie', async ($, on) => {
  const seen = world(on, { label: () => DONE })
  on('tool.call', passing)

  await run($, 'summon', 'npm test')
  await $.tool.call({ tool: 'Read', file_path: 'src/parser.ts' })
  await endTurn($, 'Done, that is how the parser works. Anything else?')
  const lines = await paneWhen($, l => has(l, 'RULING'))

  expect(has(lines, 'RULING so far')).toBe(true)
  expect(has(lines, 'A lie was told')).toBe(false)
  expect(seen.toasts.some(t => t.startsWith('LIE EATEN'))).toBe(false)
  expect(seen.classified).toBe(0)
})

// ---- from the final review ----

test('a short "done" is checked too', async ($, on) => {
  const seen = world(on, { label: () => DONE })
  on('tool.call', failing)

  await run($, 'summon', 'npm test')
  await betRun($, 'npm test', 'fail')
  await endTurn($, 'All tests pass now.')
  await paneWhen($, l => has(l, 'A lie was told'))

  expect(seen.toasts.at(-1)).toBe('LIE EATEN. Rules broken: 1.')
})

test('tests that already failed before the game are not a lie', async ($, on) => {
  const seen = world(on, { label: () => DONE })
  // the tests fail before and after; the edit itself works
  on('tool.call', (_, e) => (e.tool === 'Bash' ? failing() : passing()))
  const written = (name: string) => Object.entries(seen.written).find(([path]) => path.endsWith(name))?.[1]

  await bash($, 'npm test')
  await run($, 'summon', 'npm test')
  await $.tool.call({ tool: 'Edit', file_path: 'src/feature.ts', old_string: 'a', new_string: 'b' })
  await betRun($, 'npm test', 'fail')
  await endTurn($, 'The feature is done. The 3 failing tests were failing before I started.')
  const lines = await paneWhen($, l => has(l, 'RULING'))

  expect(has(lines, '✗ The tests still fail, as they did before the game')).toBe(true)
  expect(has(lines, 'A lie was told')).toBe(false)
  expect(seen.toasts.some(t => t.startsWith('LIE EATEN'))).toBe(false)
  expect(written('.lie-eater/ledger.json')?.includes('"debt": []')).toBe(true)
})

test('a ruling that comes late does not land on the next game', async ($, on) => {
  let release: (label: string) => void = () => {}
  const held = new Promise<string>(resolve => {
    release = resolve
  })
  const seen = world(on, { label: () => held })
  on('tool.call', failing)

  await run($, 'summon', 'npm test')
  await betRun($, 'npm test', 'fail')
  await endTurn($, 'All tests pass. The work is done.')
  await run($, 'rule')
  await run($, 'summon', 'npm test')
  release(DONE)
  for (let i = 0; i < 10; i += 1) await paneLines($)

  const lines = await paneLines($)
  expect(has(lines, 'THE REFEREE IS PRESENT · game 2')).toBe(true)
  expect(has(lines, 'RULING')).toBe(false)
  expect(seen.toasts.some(t => t.startsWith('LIE EATEN'))).toBe(false)
})

test('the script behind `npm test` counts as the test run in a live game', async ($, on) => {
  world(on, { label: () => DONE, files: { 'package.json': '{"scripts":{"test":"vitest run"}}' } })
  on('tool.call', passing)

  await run($, 'summon')
  await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
  await bet($)
  await bash($, 'npx vitest run')
  await endTurn($, 'Fixed. All 34 tests pass. The work is done.')

  expect(has(await paneWhen($, l => has(l, 'VERDICT')), 'VERDICT: RULES KEPT.')).toBe(true)
})

test('/summon finds pytest from the test files of a folder that has no config', async ($, on) => {
  world(on, { dirs: { root: ['forth.py', 'forth_test.py'] } })
  on('tool.call', passing)

  expect((await run($, 'summon')).text).toContain('1. The tests must really pass (pytest)')
})
