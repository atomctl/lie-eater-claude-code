import { expect, test } from 'claude-code/testing'

import { BET_DESCRIPTION, BET_SCHEMA, gateText } from '../hooks/lib/bets'
import { DONE_SCHEMA } from '../hooks/lib/referee'
import { bash, bet, betRun, endTurn, paneLines, run, world } from './kit'

const failing = () => ({ result: 'Exit code 1', isError: true as const, text: 'Exit code 1\n3 failed, 31 passed in 2.10s' })
const passing = () => ({ result: {}, text: '34 passed in 1s' })
const has = (lines: string[], text: string) => lines.some(l => l.includes(text))
const edit = ($: Parameters<typeof bash>[0]) =>
  $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })

test('the bet tool and the done tool are registered when the session starts', async ($, on) => {
  const seen = world(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(seen.tools).toHaveLength(2)
  expect(seen.tools[0]).toMatchObject({ name: 'bet', inputSchema: BET_SCHEMA, isDeferred: false })
  expect(seen.tools[1]).toMatchObject({ name: 'done', inputSchema: DONE_SCHEMA, isDeferred: false })
  expect(DONE_SCHEMA).toEqual({
    type: 'object',
    properties: {
      broken: { type: 'string', maxLength: 500, description: 'Rules you know are broken, in your own words. Leave it out when none.' },
    },
  })
  // the AI learns of the done tool where it learns of the bet
  expect(BET_DESCRIPTION).toContain('When the task is finished, call the done tool.')
})

test('a test run with no bet is refused, and the person is told why', async ($, on) => {
  const seen = world(on)
  let ran = 0
  on('tool.call', () => {
    ran += 1

    return passing()
  })

  await run($, 'summon', 'npm test')
  const out = await bash($, 'npm test')

  expect(out).toEqual({ deny: gateText('npm test') })
  expect(ran).toBe(0)
  expect(seen.toasts.at(-1)).toBe('The referee asked the AI for its bet.')
})

test('an agent that ignores the gate is never stuck: the third run goes through and is counted', async ($, on) => {
  world(on)
  on('tool.call', passing)

  await run($, 'summon', 'npm test')
  expect(await bash($, 'npm test')).toEqual({ deny: gateText('npm test') })
  expect(await bash($, 'npm test')).toEqual({ deny: gateText('npm test') })
  expect(await bash($, 'npm test')).toMatchObject({ text: '34 passed in 1s' })
  expect(has(await paneLines($), '1 run without a bet')).toBe(true)

  await $.prompt.submit({ text: 'go on' } as never)
  expect(await bash($, 'npm test')).toEqual({ deny: gateText('npm test') })
})

test('only a test or build run of the main agent, with a referee present, is gated', async ($, on) => {
  world(on)
  on('tool.call', passing)

  expect(await bash($, 'npm test')).toMatchObject({ text: '34 passed in 1s' })
  await run($, 'summon', 'npm test')
  expect(await bash($, 'ls -la')).toMatchObject({ text: '34 passed in 1s' })
  expect(await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'a1' })).toMatchObject({
    text: '34 passed in 1s',
  })
  expect(await bash($, 'npm run build')).toEqual({ deny: gateText('npm test') })
})

test('a bet is taken, shown as open, and is not a recorded tool call', async ($, on) => {
  world(on)
  on('tool.call', passing)

  expect(await bet($)).toMatchObject({ result: 'No referee is present. No bet taken.' })
  await run($, 'summon', 'npm test')
  expect(await bet($)).toMatchObject({ result: 'Bet #1 taken: the next run will pass, 90% sure. The test command of this game is `npm test`.' })
  expect(await bet($)).toMatchObject({ result: 'Bet refused: a bet is already open.' })

  const lines = await paneLines($)
  expect(has(lines, '#1 the next run will pass, 90% sure')).toBe(true)
  expect(has(lines, 'OPEN')).toBe(true)
  expect(has(lines, 'No tool calls yet.')).toBe(true)
})

test('a lost bet: the agent is told on the result, the person hears it', async ($, on) => {
  const seen = world(on)
  on('tool.call', failing)

  await run($, 'summon', 'npm test')
  const out = await betRun($, 'npm test')

  expect(out).toMatchObject({ result: 'Exit code 1', isError: true })
  expect(out.context?.at(-1)).toBe(
    'Lie Eater: bet #1 LOST. You said the next run will pass, 90% sure. The run: npm test → 3 failed, 31 passed in 2.10s.',
  )
  expect(seen.toasts.at(-1)).toBe('BET LOST: the next run will pass, 90% sure')
  expect(seen.sounds).toBe(2)

  const lines = await paneLines($)
  expect(has(lines, 'LOST · npm test → 3 failed, 31 passed in 2.10s')).toBe(true)
  expect(has(lines, 'The AI said "90% sure". It was right 0 of 1 times.')).toBe(true)
  expect(has(lines, 'Bets: 0 won, 1 lost')).toBe(true)
})

test('a won bet: a toast, no sound, the status counts it', async ($, on) => {
  const seen = world(on)
  on('tool.call', passing)

  await run($, 'summon', 'npm test')
  const out = await betRun($, 'npm test')

  expect(out.context?.at(-1)).toBe(
    'Lie Eater: bet #1 WON. You said the next run will pass, 90% sure. The run: npm test → 34 passed in 1s. If the task is finished, call the done tool.',
  )
  expect(seen.toasts.at(-1)).toBe('BET WON: the next run will pass, 90% sure')
  expect(seen.sounds).toBe(1)
  expect(seen.status.at(-1)).toContain('Referee present · bets 1/1')
})

test('a bet settled on a piped run of the test command says that run cannot end the game', async ($, on) => {
  world(on)
  on('tool.call', passing)

  await run($, 'summon', 'pytest')
  const out = await betRun($, 'pytest -q 2>&1 | tail -5')

  expect(out.context?.at(-1)).toBe(
    'Lie Eater: bet #1 WON. You said the next run will pass, 90% sure. The run: pytest -q 2>&1 | tail -5 → 34 passed in 1s. This run cannot end the game: run `pytest` by itself before you call done.',
  )
  // a passing run of another command says nothing of the done tool
  await edit($)
  expect((await betRun($, 'npm run build')).context?.at(-1)).not.toContain('done')
})

test('a bet on a result that was already known is void', async ($, on) => {
  world(on)
  on('tool.call', passing)

  await run($, 'summon', 'npm test')
  await betRun($, 'npm test')
  const again = await betRun($, 'npm test')

  expect(again.context?.at(-1)).toBe(
    'Lie Eater: bet #2 VOID. Nothing changed since the last run. If the task is finished, call the done tool.',
  )
  const lines = await paneLines($)
  expect(has(lines, 'VOID · nothing changed since the last run')).toBe(true)
  expect(has(lines, 'Bets: 1 won, 0 lost, 1 void')).toBe(true)

  // after a code edit the result is open again
  await edit($)
  expect((await betRun($, 'npm test')).context?.at(-1)).toContain('bet #3 WON')
})

test('a run with no readable result leaves the bet open; the end of the turn makes it void', async ($, on) => {
  world(on)
  on('tool.call', () => ({ result: { backgroundTaskId: 'b1' }, text: 'Command running in background with ID: b1' }))

  await run($, 'summon', 'npm test')
  const out = await betRun($, 'npm test')
  expect(out.context).toBeUndefined()
  expect(has(await paneLines($), 'OPEN')).toBe(true)

  await endTurn($, 'Still running.')
  expect(has(await paneLines($), 'VOID · no run settled it')).toBe(true)
})

test("a subagent's run does not settle the main agent's bet", async ($, on) => {
  world(on)
  on('tool.call', passing)

  await run($, 'summon', 'npm test')
  await bet($)
  await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'a1' })

  expect(has(await paneLines($), 'OPEN')).toBe(true)
})

test('a bad bet is refused and the gate stays shut', async ($, on) => {
  world(on)
  on('tool.call', passing)

  await run($, 'summon', 'npm test')
  expect(await bet($, 'pass', 1)).toMatchObject({
    result: 'Bet refused: give expect ("pass" or "fail") and confidence (0.5 to 0.99).',
  })
  expect(await bash($, 'npm test')).toEqual({ deny: gateText('npm test') })
})

test('the dice turns in the spinner row only while a bet is open', async ($, on) => {
  const seen = world(on)
  on('tool.call', passing)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{String((e.props as { word?: string }).word)}</Text>
  })
  const spinner = async () => {
    const ui = await $.ui.mount({
      plugin: 'lie-eater',
      component: 'Spinner',
      requestId: 'main',
      surface: 'terminal',
      props: { word: 'Working', message: null, suffix: '…', mode: 'thinking' },
    })
    const text = (await ui.find({ type: 'Text' }))?.text
    await ui.unmount()

    return text
  }

  expect(await spinner()).toBe('Working')
  await run($, 'summon', 'npm test')
  await bet($)
  expect(await spinner()).toMatch(/^[⚀⚁⚂⚃⚄⚅] bet open: the next run will pass, 90% sure$/)
  // the timer asks for a redraw while the bet is open
  await seen.tick()
  await bash($, 'npm test')
  expect(await spinner()).toBe('Working')
})

// ---- bet against your AI ----

test('while a bet is open the person may call it too; the pane keeps both scores', async ($, on) => {
  const seen = world(on)
  on('tool.call', failing)
  const mount = () =>
    $.ui.mount({
      plugin: 'lie-eater',
      component: 'Pane',
      requestId: 'lie-eater',
      surface: 'terminal',
      props: { title: 'Lie Eater', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
    })

  await run($, 'summon', 'npm test')
  let ui = await mount()
  expect(await ui.find({ key: 'call-pass' })).toBeUndefined()
  await ui.unmount()

  await bet($)
  ui = await mount()
  expect(await ui.find({ key: 'call-pass' })).toBeDefined()
  await ui.press({ key: 'call-fail' })
  await ui.unmount()
  expect(has(await paneLines($), 'OPEN · you: it will fail')).toBe(true)

  await bash($, 'npm test')
  const lines = await paneLines($)
  expect(seen.toasts.slice(-2)).toEqual(['BET LOST: the next run will pass, 90% sure', 'You called it right.'])
  expect(has(lines, 'You 1 of 1 · the AI 0 of 1')).toBe(true)
  ui = await mount()
  expect(await ui.find({ key: 'call-pass' })).toBeUndefined()
  await ui.unmount()

  const ledger = JSON.parse(Object.entries(seen.written).find(([path]) => path.endsWith('.lie-eater/ledger.json'))?.[1] ?? '{}')
  expect(ledger.bets[0]).toMatchObject({ won: false, youWon: true })
})

test('/call does the same as the buttons, and says so when no bet is open', async ($, on) => {
  const seen = world(on)
  on('tool.call', passing)

  await run($, 'summon', 'npm test')
  expect((await run($, 'call', 'pass')).text).toBe('No bet is open.')
  await bet($)
  expect((await run($, 'call', 'maybe')).text).toBe('Type /call pass or /call fail while a bet is open.')
  expect((await run($, 'call', 'fail')).text).toBe('You called it: the next run will fail.')
  await bash($, 'npm test')

  expect(seen.toasts.at(-1)).toBe('You called it wrong.')
  expect(has(await paneLines($), 'You 0 of 1 · the AI 1 of 1')).toBe(true)
})

test('a chain that failed before the test run started does not lose the bet', async ($, on) => {
  const seen = world(on)
  let started = false
  on('tool.call', (_, e) =>
    e.tool !== 'Bash' || started
      ? passing()
      : { result: 'Exit code 1', isError: true as const, text: 'Exit code 1\n(eval):cd:1: no such file or directory: api' },
  )

  await run($, 'summon', 'npm test')
  await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
  await bet($)
  await bash($, 'cd api && npm test')

  expect(seen.toasts.some(t => t.startsWith('BET LOST'))).toBe(false)
  expect(has(await paneLines($), 'OPEN')).toBe(true)

  // the run that does start settles that bet: its result was not known before
  started = true
  await bash($, 'npm test')

  expect(seen.toasts.at(-1)).toBe('BET WON: the next run will pass, 90% sure')
  expect(has(await paneLines($), 'VOID')).toBe(false)
})
