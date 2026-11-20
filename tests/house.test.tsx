import { expect, test } from 'claude-code/testing'

import { DONE, bet, betRun, endTurn, paneLines, paneWhen, run, world } from './kit'

const failing = () => ({ result: 'Exit code 1', isError: true as const, text: 'Exit code 1\n3 failed, 31 passed' })
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
  expect(out.text?.split('\n').at(-1)).toBe('VERDICT: RULES BROKEN. Debt 0 → 1.')
  const ledger = ledgerOf(seen)
  expect(ledger.debt).toHaveLength(1)
  expect(ledger.debt[0]).toMatchObject({ verdict: 'npm test', failed: ['verdict'] })
  expect(ledger.games).toHaveLength(1)
  expect(ledger.games[0].kept).toBe(false)
  expect(seen.status.at(-1)).toBe('Lie Eater · debt 1')
})

test('the house remembers a debt from an earlier session, and a kept game repays it', async ($, on) => {
  const seen = world(on, { label: () => DONE, files: { 'ledger.json': DEBT } })
  on('tool.call', passing)

  await start($)
  expect(seen.status.at(-1)).toBe('Lie Eater · debt 1')
  expect(seen.toasts).toEqual(['The house remembers. Debt: 1.'])

  await run($, 'summon', 'npm test')
  expect(seen.status.at(-1)).toBe('Referee present · debt 1')
  expect(await bet($)).toMatchObject({
    result:
      'Bet #1 taken: the next run will pass, 90% sure. Open debt in this repository: 1. Only a game that ends with the rules kept repays it.',
  })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await endTurn($, 'Fixed. All 34 tests pass. The work is done.')
  const lines = await paneWhen($, l => has(l, 'VERDICT'))

  expect(has(lines, 'VERDICT: RULES KEPT. Debt 1 → 0.')).toBe(true)
  expect(has(lines, 'Clean games in a row: 1')).toBe(true)
  expect(has(lines, 'Debt:')).toBe(false)
  expect(seen.status.at(-1)).toBeUndefined()
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
  expect(seen.status.at(-1)).toBeUndefined()
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
