import { expect, test } from 'claude-code/testing'

import { bet, betRun, detailLines, done, editCode, project, run, start, world } from './kit'

const failing = () => ({ result: 'Exit code 1', isError: true as const, text: 'Exit code 1\n3 failed, 31 passed in 2.10s' })
const passing = () => ({ result: {}, text: '34 passed in 1s' })
const has = (lines: string[], text: string) => lines.some(l => l.includes(text))
// The engine hands a hook the full path of the file.
const writtenAt = (seen: { written: Record<string, string> }, name: string) =>
  Object.entries(seen.written).find(([path]) => path.endsWith(name))?.[1]
const ledgerOf = (seen: { written: Record<string, string> }) => JSON.parse(writtenAt(seen, '.lie-eater/ledger.json') ?? '{}')
const receiptOf = (seen: { written: Record<string, string> }) => JSON.parse(writtenAt(seen, '.lie-eater/receipts.json') ?? '{}')
const GUTTED = "it('adds', () => {\n  expect(add(1, 2)).toBe(3)\n})\n"
// A ledger of the version before: games and a debt beside the bets.
const OLD_LEDGER = JSON.stringify({
  version: 1,
  bets: [{ at: '2026-11-19T10:00:00.000Z', confidence: 0.8, won: true }],
  games: [{ at: '2026-11-19T10:00:00.000Z', termsAt: 5, kept: false }],
  debt: [{ id: 1, at: '2026-11-19T10:00:00.000Z', termsAt: 5, verdict: 'npm test', failed: ['verdict'], text: 'game of 2026-11-19: npm test' }],
})

test('a settled bet goes into the ledger file of the project', async ($, on) => {
  const seen = world(on, project())
  on('tool.call', failing)

  await start($)
  await betRun($, 'npm test')

  const ledger = ledgerOf(seen)
  expect(ledger.version).toBe(1)
  expect(ledger.bets).toHaveLength(1)
  expect(ledger.bets[0]).toMatchObject({ confidence: 0.9, won: false })
  expect(has(await detailLines($), 'In this repository the AI said "90% sure" and was right 0 of 1 times.')).toBe(true)
})

test('a ledger of the version before: its bets count, its games and debt are not shown', async ($, on) => {
  const opts = project()
  opts.files['ledger.json'] = OLD_LEDGER
  const seen = world(on, opts)
  on('tool.call', passing)

  await start($)
  expect(seen).toMatchObject({ toasts: [] })
  expect(seen.status.at(-1)).toBe('Lie Eater · watching')
  expect(has(await detailLines($), 'In this repository the AI said "80% sure" and was right 1 of 1 times.')).toBe(true)
  await betRun($, 'npm test')
  expect(ledgerOf(seen)).toEqual({
    version: 1,
    bets: [
      { at: '2026-11-19T10:00:00.000Z', confidence: 0.8, won: true },
      { at: expect.any(String), confidence: 0.9, won: true },
    ],
  })
})

test('a broken ledger file does not stop the session', async ($, on) => {
  const opts = project()
  opts.files['ledger.json'] = '{oops'
  const seen = world(on, opts)
  on('tool.call', passing)

  await start($)
  expect(seen.toasts).toEqual([])
  expect(seen.status.at(-1)).toBe('Lie Eater · watching')
})

test('a ledger file with broken entries does not stop a check', async ($, on) => {
  const opts = project()
  opts.files['ledger.json'] = '{"version":1,"bets":[null]}'
  world(on, opts)
  on('tool.call', passing)

  await start($)
  expect(await bet($)).toMatchObject({
    result: 'Bet #1 taken: the next run will pass, 90% sure. The full check of this project is `npm test`.',
  })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })

  expect(String((await done($)).result).split('\n')[0]).toBe('✓ checked')
})

test('a ledger file that cannot be read is kept aside, not overwritten', async ($, on) => {
  const conflicted = '<<<<<<< HEAD\n{"version":1,"bets":[]}\n=======\n'
  const opts = project()
  opts.files['ledger.json'] = conflicted
  const seen = world(on, opts)
  on('tool.call', failing)

  await start($)
  expect(writtenAt(seen, '.lie-eater/ledger.unreadable.json')).toBe(conflicted)
  await betRun($, 'npm test')
  expect(ledgerOf(seen).bets).toHaveLength(1)
})

test('each done call writes the receipts (version 4) and the card', async ($, on) => {
  const opts = project()
  const seen = world(on, opts)
  on('tool.call', passing)

  await start($)
  expect(writtenAt(seen, '.lie-eater/receipts.json')).toBeUndefined()
  await editCode($)
  await done($)
  expect(receiptOf(seen)).toMatchObject({ format: 'lie-eater/receipts', version: 4, check: { command: 'npm test' } })
  expect(receiptOf(seen).results.map((r: { result: string }) => r.result)).toEqual(['unchecked'])

  await betRun($, 'npm test')
  await done($)
  expect(receiptOf(seen).results.map((r: { result: string }) => r.result)).toEqual(['unchecked', 'checked'])
  // a green result keeps which kind of green it was; another result has no such field
  expect(receiptOf(seen).results.map((r: { added?: string[] }) => r.added)).toEqual([undefined, []])
  expect(receiptOf(seen).bets).toHaveLength(1)
  expect(writtenAt(seen, '.lie-eater/receipts.md')?.startsWith('# Lie Eater receipts')).toBe(true)
  const card = writtenAt(seen, '.lie-eater/card.svg') ?? ''
  expect(card.startsWith('<svg')).toBe(true)
  expect(card).toContain('✓ checked')
  expect(card).toContain('The AI added no new check for this change.')
})

test('an accepted change is written into the receipts', async ($, on) => {
  const opts = project()
  const seen = world(on, opts)
  on('tool.call', passing)

  await start($)
  opts.files['math.test.ts'] = GUTTED
  await editCode($, 'tests/math.test.ts')
  await betRun($, 'npm test')
  await done($)
  await run($, 'accept')

  expect(receiptOf(seen).results.at(-1)).toMatchObject({ result: 'distrust', lie: true, accepted: true })
  expect(writtenAt(seen, '.lie-eater/card.svg')).toContain('You accepted this change.')
})

test("the house's files go to the project's root, wherever the AI's shell stands", async ($, on) => {
  const seen = world(on, { ...project(), root: '/home/me/calc' })
  on('tool.call', passing)

  await start($)
  await betRun($, 'cd packages/api && npm test')
  await done($)

  expect(Object.keys(seen.written).sort()).toEqual([
    '/home/me/calc/.lie-eater/card.svg',
    '/home/me/calc/.lie-eater/ledger.json',
    '/home/me/calc/.lie-eater/receipts.json',
    '/home/me/calc/.lie-eater/receipts.md',
  ])
})

test("the demo project is made in the project's root too", async ($, on) => {
  const seen = world(on, { root: '/home/me/calc' })

  await run($, 'lie-eater', 'demo')

  expect(Object.keys(seen.written).sort()).toEqual([
    '/home/me/calc/.lie-eater/demo/price.mjs',
    '/home/me/calc/.lie-eater/demo/price.test.mjs',
  ])
})
