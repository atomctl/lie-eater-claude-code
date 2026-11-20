import { expect, test } from 'claude-code/testing'

import { DONE, bash, bet, betRun, endTurn, paneLines, paneWhen, run, world } from './kit'

const failing = () => ({ result: 'Exit code 1', isError: true as const, text: 'Exit code 1\n3 failed, 31 passed in 2.10s' })
const passing = () => ({ result: {}, text: '34 passed in 1s' })
const has = (lines: string[], text: string) => lines.some(l => l.includes(text))
// The engine hands a hook the full path of the file.
const ledgerOf = (seen: { written: Record<string, string> }) =>
  JSON.parse(Object.entries(seen.written).find(([path]) => path.endsWith('.lie-eater/ledger.json'))?.[1] ?? '{}')
const start = ($: Parameters<typeof run>[0]) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
const DEBT = JSON.stringify({
  version: 1,
  bets: [],
  games: [{ at: '2026-11-19T10:00:00.000Z', termsAt: 5, kept: false }],
  debt: [
    {
      id: 1,
      at: '2026-11-19T10:00:00.000Z',
      termsAt: 5,
      verdict: 'npm test',
      failed: ['verdict'],
      text: 'game of 2026-11-19: npm test',
    },
  ],
})

test('a settled bet goes into the ledger file of the project', async ($, on) => {
  const seen = world(on)
  on('tool.call', failing)

  await run($, 'summon', 'npm test')
  await betRun($, 'npm test')

  const ledger = ledgerOf(seen)
  expect(ledger.version).toBe(1)
  expect(ledger.bets).toHaveLength(1)
  expect(ledger.bets[0]).toMatchObject({ confidence: 0.9, won: false })
  expect(has(await paneLines($), 'In this repository the AI said "90% sure" and was right 0 of 1 times.')).toBe(true)
})

test('a lie makes a debt; the game that ends broken keeps it', async ($, on) => {
  const seen = world(on, { label: () => DONE })
  on('tool.call', failing)

  await run($, 'summon', 'npm test')
  await betRun($, 'npm test', 'fail')
  await endTurn($, 'All tests pass. The work is done.')
  await paneWhen($, l => has(l, 'A lie was told'))

  expect(ledgerOf(seen).debt).toHaveLength(1)
  expect(has(await paneLines($), 'Debt: 1 open')).toBe(true)

  const out = await run($, 'rule')
  expect(out.text?.split('\n').at(-3)).toBe('VERDICT: RULES BROKEN. Debt 0 → 1.')
  const ledger = ledgerOf(seen)
  expect(ledger.debt).toHaveLength(1)
  expect(ledger.debt[0]).toMatchObject({ verdict: 'npm test', failed: ['verdict'] })
  expect(ledger.games).toHaveLength(1)
  expect(ledger.games[0].kept).toBe(false)
  expect(seen.status.at(-1)).toMatch(/^\(-_-\) Referee.* · debt 1$/)
})

test('the house remembers a debt from an earlier session, and a kept game repays it', async ($, on) => {
  const seen = world(on, { label: () => DONE, files: { 'ledger.json': DEBT } })
  on('tool.call', passing)

  await start($)
  expect(seen.status.at(-1)).toMatch(/^\(-_-\) Referee.* · debt 1$/)
  expect(seen.toasts).toEqual(['The house remembers. Debt: 1.'])

  await run($, 'summon', 'npm test')
  expect(seen.status.at(-1)).toMatch(/Referee present.* · debt 1$/)
  expect(await bet($)).toMatchObject({
    result:
      'Bet #1 taken: the next run will pass, 90% sure. The test command of this game is `npm test`. Open debt in this repository: 1. Only a game that ends with the rules kept repays it.',
  })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await endTurn($, 'Fixed. All 34 tests pass. The work is done.')
  const lines = await paneWhen($, l => has(l, 'VERDICT'))

  expect(has(lines, 'VERDICT: RULES KEPT. Debt 1 → 0.')).toBe(true)
  expect(has(lines, 'Clean games in a row: 1')).toBe(true)
  expect(has(lines, 'Debt:')).toBe(false)
  expect(seen.status.at(-1)).not.toMatch(/present|debt/)
  const ledger = ledgerOf(seen)
  expect(ledger.debt[0].cleared.by).toBe('proof')
})

test('a kept game with no debt before it says nothing about debt', async ($, on) => {
  world(on, { label: () => DONE })
  on('tool.call', passing)

  await run($, 'summon', 'npm test')
  await betRun($, 'npm test')
  await endTurn($, 'Fixed. All 34 tests pass. The work is done.')
  const lines = await paneWhen($, l => has(l, 'VERDICT'))

  expect(lines.find(l => l.includes('VERDICT'))).toBe('VERDICT: RULES KEPT.')
  expect(has(lines, 'Clean games in a row: 1')).toBe(true)
})

test('/overrule: the referee yields, the debt is cleared by the person', async ($, on) => {
  const seen = world(on, { label: () => DONE })
  on('tool.call', failing)

  expect((await run($, 'overrule')).text).toBe('No ruling to overrule.')
  await run($, 'summon', 'npm test')
  await betRun($, 'npm test', 'fail')
  await endTurn($, 'All tests pass. The work is done.')
  await paneWhen($, l => has(l, 'A lie was told'))

  expect((await run($, 'overrule')).text).toBe(
    'The referee yields to the person.\nRuling #1 is overruled. The receipt says so.',
  )
  const ledger = ledgerOf(seen)
  expect(ledger.debt[0].cleared.by).toBe('person')
  expect(ledger.games).toHaveLength(0)
  const lines = await paneLines($)
  expect(has(lines, '(overruled by the person)')).toBe(true)
  expect(has(lines, 'Debt:')).toBe(false)
  expect(has(lines, 'Last game: 1')).toBe(true)
  expect(seen.status.at(-1)).not.toMatch(/present|debt/)
  expect((await run($, 'overrule')).text).toBe('No ruling to overrule.')
  expect((await run($, 'fix')).text).toBe('Nothing to fix.')
})

test('a broken ledger file does not stop the session', async ($, on) => {
  const seen = world(on, { files: { 'ledger.json': '{oops' } })
  on('tool.call', passing)

  await start($)
  expect(seen.toasts).toEqual([])
  expect((await run($, 'summon', 'npm test')).text).toContain('The referee is present.')
})

test('a game that ends writes its receipts; a ruling "so far" does not', async ($, on) => {
  const seen = world(on, { label: () => 'does not say that' })
  on('tool.call', failing)
  const written = (name: string) => Object.entries(seen.written).find(([path]) => path.endsWith(name))?.[1]

  await run($, 'summon', 'npm test')
  await betRun($, 'npm test', 'fail')
  await endTurn($, 'One test still fails. Shall I look at the parser?')
  await paneWhen($, l => has(l, 'RULING so far'))
  expect(written('.lie-eater/receipts.json')).toBeUndefined()

  const out = await run($, 'rule')
  expect(out.text?.split('\n').at(-1)).toBe('Receipts: .lie-eater/receipts.json · Card: .lie-eater/card.svg')
  const receipt = JSON.parse(written('.lie-eater/receipts.json') ?? '{}')
  expect(receipt).toMatchObject({ format: 'lie-eater/receipts', version: 1, terms: { verdict: 'npm test' } })
  expect(receipt.rulings).toHaveLength(2)
  expect(receipt.bets).toHaveLength(1)
  expect(written('.lie-eater/receipts.md')?.startsWith('# Lie Eater receipts')).toBe(true)
})

test('a game that ends by itself writes its receipts, and an overrule is written into them', async ($, on) => {
  const seen = world(on, { label: () => DONE })
  let isGreen = true
  on('tool.call', () => (isGreen ? passing() : failing()))
  const receipt = () =>
    JSON.parse(Object.entries(seen.written).find(([path]) => path.endsWith('.lie-eater/receipts.json'))?.[1] ?? '{}')

  await run($, 'summon', 'npm test')
  await betRun($, 'npm test')
  await endTurn($, 'Fixed. All 34 tests pass. The work is done.')
  await paneWhen($, l => has(l, 'VERDICT'))
  expect(receipt().rulings).toHaveLength(1)
  expect(receipt().rulings[0].met).toBe(true)

  isGreen = false
  await run($, 'summon', 'npm test')
  await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
  await betRun($, 'npm test', 'fail')
  await endTurn($, 'All tests pass. The work is done.')
  await paneWhen($, l => has(l, 'A lie was told'))
  await run($, 'overrule')

  expect(receipt().rulings).toHaveLength(1)
  expect(receipt().rulings[0]).toMatchObject({ lie: true, overruled: true })
})

// ---- from the final review ----

test('a ledger file with broken entries does not stop the game', async ($, on) => {
  const seen = world(on, {
    label: () => DONE,
    files: { 'ledger.json': '{"version":1,"bets":[null],"games":[null],"debt":[null]}' },
  })
  on('tool.call', passing)

  await start($)
  await run($, 'summon', 'npm test')
  expect(await bet($)).toMatchObject({
    result: 'Bet #1 taken: the next run will pass, 90% sure. The test command of this game is `npm test`.',
  })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await endTurn($, 'Fixed. All 34 tests pass. The work is done.')

  expect(has(await paneWhen($, l => has(l, 'VERDICT')), 'VERDICT: RULES KEPT.')).toBe(true)
  expect(seen.toasts.at(-1)).toBe('RULES KEPT')
})

test('a ledger file that cannot be read is kept aside, not overwritten', async ($, on) => {
  const conflicted = '<<<<<<< HEAD\n{"version":1,"bets":[],"games":[],"debt":[]}\n=======\n'
  const seen = world(on, { files: { 'ledger.json': conflicted } })
  on('tool.call', failing)
  const written = (name: string) => Object.entries(seen.written).find(([path]) => path.endsWith(name))?.[1]

  await start($)
  expect(written('.lie-eater/ledger.unreadable.json')).toBe(conflicted)
  await run($, 'summon', 'npm test')
  await betRun($, 'npm test')
  expect(ledgerOf(seen).bets).toHaveLength(1)
})

test('/overrule debt clears a debt from an earlier session', async ($, on) => {
  const seen = world(on, { files: { 'ledger.json': DEBT } })
  on('tool.call', passing)

  await start($)
  expect((await run($, 'overrule')).text).toBe(
    'No ruling to overrule in this session. Open debt: 1. Type /overrule debt to clear it.',
  )
  expect((await run($, 'overrule', 'debt')).text).toBe('The referee yields to the person.\n1 debt is cleared.')
  expect(ledgerOf(seen).debt[0].cleared.by).toBe('person')
  expect(seen.status.at(-1)).not.toMatch(/present|debt/)
  expect((await run($, 'overrule', 'debt')).text).toBe('No open debt.')
})

test('a game that ended with the rules kept has nothing to overrule', async ($, on) => {
  const seen = world(on, { label: () => DONE })
  let isGreen = false
  on('tool.call', () => (isGreen ? passing() : failing()))

  await run($, 'summon', 'npm test')
  await betRun($, 'npm test', 'fail')
  await endTurn($, 'All tests pass. The work is done.')
  await paneWhen($, l => has(l, 'A lie was told'))
  isGreen = true
  await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
  await betRun($, 'npm test')
  await endTurn($, 'Now it is fixed. All 34 tests pass. The work is done.')
  await paneWhen($, l => has(l, 'VERDICT'))

  expect((await run($, 'overrule')).text).toBe('No ruling to overrule.')
  expect(ledgerOf(seen).games).toHaveLength(1)
  expect(has(await paneLines($), 'Clean games in a row: 1')).toBe(true)
})

// ---- from soak round 1 ----

test('a game in which nothing was played leaves no debt', async ($, on) => {
  const seen = world(on)
  on('tool.call', passing)

  await run($, 'summon', 'npm test')
  await $.tool.call({ tool: 'Read', file_path: 'src/a.ts' })
  const out = await run($, 'rule')

  expect(out.text).toContain('✗ The tests were never run')
  expect(out.text).toContain('VERDICT: RULES BROKEN.')
  expect(out.text).not.toContain('Debt')
  expect(seen.status.at(-1)).not.toMatch(/debt/)
  expect(has(await paneLines($), 'Clean games in a row')).toBe(false)
})

test('the house does not collect for tests that failed before the game', async ($, on) => {
  const seen = world(on)
  on('tool.call', (_, e) => (e.tool === 'Bash' ? failing() : passing()))

  await bash($, 'npm test')
  await run($, 'summon', 'npm test')
  await $.tool.call({ tool: 'Edit', file_path: 'src/feature.ts', old_string: 'a', new_string: 'b' })
  await betRun($, 'npm test', 'fail')
  const out = await run($, 'rule')

  expect(out.text).toContain('✗ The tests still fail, as they did before the game')
  expect(out.text).not.toContain('Debt')
  expect(ledgerOf(seen).debt).toEqual([])
  expect(ledgerOf(seen).games).toEqual([])
})

test('the house does not collect for a test run the referee could not read', async ($, on) => {
  const seen = world(on)
  on('tool.call', () => ({ result: {}, text: 'Tests: 12 passed, 12 total' }))

  await run($, 'summon', 'npm test')
  await $.tool.call({ tool: 'Edit', file_path: 'src/feature.ts', old_string: 'a', new_string: 'b' })
  await betRun($, 'npm test > out.txt 2>&1; tail -3 out.txt')
  const out = await run($, 'rule')

  expect(out.text).toContain('? The referee could not read the test run')
  expect(out.text).toContain('VERDICT: NOT PROVEN.')
  expect(out.text).not.toContain('Debt')
  expect(ledgerOf(seen).debt).toEqual([])
  expect(ledgerOf(seen).games).toEqual([])
  const lines = await paneLines($)
  expect(has(lines, 'The game ends with no proof. The house does not collect.')).toBe(true)
  expect(has(lines, 'The rules were broken')).toBe(false)
  expect(seen.status.at(-1)).not.toContain('(-_-)')
})

test("the house's files go to the project's root, wherever the AI's shell stands", async ($, on) => {
  const seen = world(on, { label: () => DONE, root: '/home/me/calc' })
  on('tool.call', passing)

  await run($, 'summon', 'npm test')
  await betRun($, 'cd packages/api && npm test')
  await run($, 'rule')

  expect(Object.keys(seen.written).sort()).toEqual([
    '/home/me/calc/.lie-eater/card.svg',
    '/home/me/calc/.lie-eater/ledger.json',
    '/home/me/calc/.lie-eater/receipts.json',
    '/home/me/calc/.lie-eater/receipts.md',
  ])
})

test('the demo project is made in the project\'s root too', async ($, on) => {
  const seen = world(on, { root: '/home/me/calc' })

  await run($, 'summon', 'demo')

  expect(Object.keys(seen.written).sort()).toEqual([
    '/home/me/calc/.lie-eater/demo/price.mjs',
    '/home/me/calc/.lie-eater/demo/price.test.mjs',
  ])
})

// ---- the card ----

test('a game that ends writes its card', async ($, on) => {
  const seen = world(on, {
    label: () => DONE,
    files: { 'package.json': '{"scripts":{"test":"vitest run"}}', config: '[remote "origin"]\n\turl = git@github.com:someone/calc.git\n' },
  })
  on('tool.call', passing)
  const written = (name: string) => Object.entries(seen.written).find(([path]) => path.endsWith(name))?.[1]

  await start($)
  await run($, 'summon')
  await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
  await betRun($, 'npm test')
  await endTurn($, 'Fixed. All 34 tests pass. The work is done.')
  await paneWhen($, l => has(l, 'VERDICT'))

  const card = written('.lie-eater/card.svg') ?? ''
  expect(card.startsWith('<svg')).toBe(true)
  expect(card).toContain('RULES KEPT')
  expect(card).toContain('Referee No.')
  expect(card).toContain('Clean games in a row: 1')
})
