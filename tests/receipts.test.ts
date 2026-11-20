import { expect, test } from 'claude-code/testing'

import { EMPTY_LEDGER, addBet } from '../hooks/lib/ledger'
import { buildReceipt, receiptToMarkdown } from '../hooks/lib/receipts'
import { resultOf } from '../hooks/lib/result'
import { armWatch, rule, track } from '../hooks/lib/terms'
import type { Bet, Ruling } from '../types'
import { rec } from './helpers'

const NOW = '2026-11-20T12:00:00.000Z'
const WATCH = track({ ...armWatch('npm test', { id: 2, at: 5000 }, []), print: 'p' }, rec({ id: 3, kind: 'test', target: 'npm test', state: 'failed' }), 'p')
const bet = (id: number, state: Bet['state'], at: number, more: Partial<Bet> = {}): Bet => ({
  id,
  turn: 1,
  at,
  afterRecord: 0,
  expect: 'pass',
  confidence: 0.9,
  why: '',
  state,
  ...more,
})
const LINES = rule(WATCH, [], 'p')
const ruling = (id: number, termsId: number, more: Partial<Ruling> = {}): Ruling => ({
  id,
  termsId,
  turn: id,
  at: 6000,
  lines: LINES,
  ...resultOf(LINES, '', true, []),
  lie: true,
  ...more,
})
const INPUT = {
  watch: WATCH,
  rulings: [ruling(1, 1), ruling(2, 2), ruling(3, 2, { lie: false, accepted: true })],
  bets: [
    bet(1, 'won', 1000),
    bet(2, 'won', 5500, { record: 3, line: 'npm test → 34 passed' }),
    bet(3, 'lost', 5600, { record: 4, line: 'npm test → 3 failed' }),
    bet(4, 'void', 5700, { line: 'nothing changed since the last run' }),
  ],
  unbet: 1,
  ledger: addBet(EMPTY_LEDGER, { at: NOW, confidence: 0.9, won: true }),
  createdAt: NOW,
}

test('a receipt (version 4) holds one watch: its full check, its results, its bets', async () => {
  const r = buildReceipt(INPUT)

  expect(r).toMatchObject({
    format: 'lie-eater/receipts',
    version: 4,
    createdAt: NOW,
    check: { command: 'npm test', since: '1970-01-01T00:00:05.000Z' },
    unbet: 1,
    score: { n: 2, won: 1, lost: 1, hitRate: 0.5, said: 0.9 },
    repository: { line: 'In this repository the AI said "90% sure" and was right 1 of 1 times.' },
  })
  // the result and the bet of an earlier watch are not in it
  expect(r.results.map(x => x.id)).toEqual([2, 3])
  expect(r.results[0]).toMatchObject({ result: 'distrust', screen: ['✗ don\'t trust "done"', 'The checks fail.'] })
  expect(r.bets.map(x => x.id)).toEqual([2, 3, 4])
})

test('a receipt is plain data, and keeps an accepted change', async () => {
  const r = buildReceipt(INPUT)

  expect(JSON.parse(JSON.stringify(r))).toEqual(r)
  expect(r.results[1]?.accepted).toBe(true)
  expect(buildReceipt({ ...INPUT, bets: [] }).score).toBe(null)
})

test('the receipt as a page a person can read', async () => {
  const lines = receiptToMarkdown(buildReceipt(INPUT)).split('\n')

  expect(lines[0]).toBe('# Lie Eater receipts')
  for (const wanted of [
    'Full check: `npm test`, watched since 1970-01-01T00:00:05.000Z. Written 2026-11-20T12:00:00.000Z.',
    '## Results',
    '### Result 2 (turn 2)',
    '### Result 3 (turn 3), accepted by the person',
    '✗ don\'t trust "done"',
    'The checks fail.',
    '✗ The tests fail',
    '## Bets',
    '- #2 the next run will pass, 90% sure: WON · npm test → 34 passed',
    '- #3 the next run will pass, 90% sure: LOST · npm test → 3 failed',
    '- #4 the next run will pass, 90% sure: VOID · nothing changed since the last run',
    'The AI said "90% sure". It was right 1 of 2 times.',
    'Runs without a bet: 1',
    '## This repository',
    'In this repository the AI said "90% sure" and was right 1 of 1 times.',
  ]) {
    expect(`${wanted} ${lines.includes(wanted)}`).toBe(`${wanted} true`)
  }
})

test('a receipt keeps no raw command line and no text of a check file', async () => {
  const watch = { ...WATCH, verdict: 'API_KEY=sk-live-1 pytest -k "secret words"' }
  const r = buildReceipt({
    ...INPUT,
    watch,
    rulings: [ruling(1, 2, { lost: { 'tests/test_cart.py': ['    assert total([10, 20]) == 30'] } })],
    bets: [bet(2, 'won', 5500, { line: 'API_KEY=… pytest → 3 passed' })],
  })
  const text = `${JSON.stringify(r)}\n${receiptToMarkdown(r)}`

  expect(r.check.command).toBe('API_KEY=… pytest -k "…"')
  expect(text).not.toContain('sk-live-1')
  expect(text).not.toContain('secret words')
  expect(text).not.toContain('assert total')
})

test('a green result keeps which kind of green it was: the new check files, or none', async () => {
  const green = (id: number, added: string[]): Ruling => ({ id, termsId: 2, turn: id, at: 6000, lines: [], ...resultOf([], '', true, added), lie: false })
  const r = buildReceipt({ ...INPUT, rulings: [green(1, ['tests/test_tax.py']), green(2, [])] })

  expect(r.results.map(x => x.added)).toEqual([['tests/test_tax.py'], []])
  expect(receiptToMarkdown(r).split('\n')).toEqual(expect.arrayContaining(['The AI added new checks: tests/test_tax.py.', 'The AI added no new check for this change.']))
})
