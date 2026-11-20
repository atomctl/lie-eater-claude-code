import { expect, test } from 'claude-code/testing'

import { LEDGER_PATH, addBet, isLedgerText, parseLedger, repoLine } from '../hooks/lib/ledger'
import type { Ledger } from '../types'

const EMPTY: Ledger = { version: 1, bets: [] }
const DAY = '2026-11-20T10:00:00.000Z'

test('the ledger file lives in the project', async () => {
  expect(LEDGER_PATH).toBe('.lie-eater/ledger.json')
})

test('parseLedger: a missing, broken or foreign file is an empty ledger', async () => {
  for (const text of [undefined, '', '{oops', '{"version":2,"bets":[]}', '[]', 'null']) {
    expect(parseLedger(text)).toEqual(EMPTY)
  }
  const kept: Ledger = { ...EMPTY, bets: [{ at: DAY, confidence: 0.9, won: true }] }
  expect(parseLedger(JSON.stringify(kept))).toEqual(kept)
})

test('parseLedger keeps only bets of the right shape; an older file\'s games and debt are not read', async () => {
  const text = JSON.stringify({
    version: 1,
    bets: [null, { at: DAY, confidence: 0.9, won: true }, { confidence: 'high' }, 7],
    games: [{ at: DAY, termsAt: 5, kept: true }],
    debt: [{ id: 1, at: DAY, termsAt: 5, verdict: 'npm test', failed: ['verdict'], text: 'game' }],
  })
  const l = parseLedger(text)

  expect(l).toEqual({ version: 1, bets: [{ at: DAY, confidence: 0.9, won: true }] })
  expect(repoLine(l)).toBe('In this repository the AI said "90% sure" and was right 1 of 1 times.')
})

test('isLedgerText tells a ledger from a file that must not be overwritten', async () => {
  expect(isLedgerText(JSON.stringify(EMPTY))).toBe(true)
  for (const text of ['{oops', '<<<<<<< HEAD\n{"version":1}', '{"version":2,"bets":[]}', '[]']) {
    expect(`${text} ${isLedgerText(text)}`).toBe(`${text} false`)
  }
})

test('addBet keeps the newest 500', async () => {
  let l = EMPTY
  for (let i = 0; i < 505; i += 1) l = addBet(l, { at: DAY, confidence: 0.5 + (i % 40) / 100, won: i % 2 === 0 })

  expect(l.bets).toHaveLength(500)
  expect(l.bets[0]).toEqual({ at: DAY, confidence: 0.55, won: false })
})

test('repoLine says in plain words how the AI did in this repository', async () => {
  expect(repoLine(EMPTY)).toBeUndefined()

  let l = EMPTY
  for (let i = 0; i < 40; i += 1) l = addBet(l, { at: DAY, confidence: i < 20 ? 0.9 : 0.82, won: i < 31 })
  expect(repoLine(l)).toBe('In this repository the AI said "86% sure" and was right 31 of 40 times.')
})
