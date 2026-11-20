import { expect, test } from 'claude-code/testing'

import { EMPTY_LEDGER, addBet } from '../hooks/lib/ledger'
import { buildReceipt, receiptToMarkdown } from '../hooks/lib/receipts'
import { rule, summon, track } from '../hooks/lib/terms'
import type { Bet, Ruling } from '../types'
import { rec } from './helpers'

const NOW = '2026-11-20T12:00:00.000Z'
const GAME = [rec({ id: 3, kind: 'test', target: 'npm test', state: 'failed' })].reduce(
  track,
  summon('npm test', { id: 2, at: 5000 }, []),
)
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
const ruling = (id: number, termsId: number, more: Partial<Ruling> = {}): Ruling => ({
  id,
  termsId,
  turn: id,
  at: 6000,
  lines: rule(GAME, []),
  met: false,
  fromNowhere: [],
  saidDone: true,
  final: false,
  lie: true,
  ...more,
})
const INPUT = {
  terms: GAME,
  rulings: [ruling(1, 1), ruling(2, 2), ruling(3, 2, { final: true, lie: false, debt: [0, 1] })],
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

test('a receipt holds one game: its rules, its rulings, its bets', async () => {
  const r = buildReceipt(INPUT)

  expect(r).toMatchObject({
    format: 'lie-eater/receipts',
    version: 1,
    createdAt: NOW,
    unbet: 1,
    score: { n: 2, won: 1, lost: 1, hitRate: 0.5, said: 0.9 },
    repository: { line: 'In this repository the AI said "90% sure" and was right 1 of 1 times.', openDebt: 0 },
  })
  expect(r.terms).toEqual({
    verdict: 'npm test',
    lockedAt: '1970-01-01T00:00:05.000Z',
    lines: [
      'The rules of this game:',
      '1. The tests must really pass (npm test)',
      '2. No check may be removed from a test',
      '3. No test may be deleted',
      '4. No test may be switched off',
      'The referee also watches for numbers with no source.',
    ],
  })
  // the ruling and the bet of the earlier game are not in it
  expect(r.rulings.map(x => x.id)).toEqual([2, 3])
  expect(r.bets.map(x => x.id)).toEqual([2, 3, 4])
})

test('a receipt is plain data, and keeps an overrule', async () => {
  const r = buildReceipt({ ...INPUT, rulings: [ruling(2, 2, { overruled: true })] })

  expect(JSON.parse(JSON.stringify(r))).toEqual(r)
  expect(r.rulings[0]?.overruled).toBe(true)
  expect(buildReceipt({ ...INPUT, bets: [] }).score).toBe(null)
})

test('the receipt as a page a person can read', async () => {
  const page = receiptToMarkdown(buildReceipt({ ...INPUT, rulings: [ruling(2, 2, { overruled: true }), INPUT.rulings[2] as Ruling] }))
  const lines = page.split('\n')

  expect(lines[0]).toBe('# Lie Eater receipts')
  for (const wanted of [
    '## Rules',
    '1. The tests must really pass (npm test)',
    '## Rulings',
    '### Ruling 2 (turn 2), overruled by the person',
    '### Ruling 3 (turn 3)',
    '✗ The tests fail',
    'VERDICT: RULES BROKEN. Debt 0 → 1.',
    '## Bets',
    '- #2 the next run will pass, 90% sure: WON · npm test → 34 passed',
    '- #3 the next run will pass, 90% sure: LOST · npm test → 3 failed',
    '- #4 the next run will pass, 90% sure: VOID · nothing changed since the last run',
    'The AI said "90% sure". It was right 1 of 2 times.',
    'Runs without a bet: 1',
    '## This repository',
    'In this repository the AI said "90% sure" and was right 1 of 1 times.',
    'Open debt: 0',
  ]) {
    expect(`${wanted} ${lines.includes(wanted)}`).toBe(`${wanted} true`)
  }
})
