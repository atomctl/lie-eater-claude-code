import { expect, test } from 'claude-code/testing'

import {
  LEDGER_PATH,
  addBet,
  addDebt,
  addGame,
  dropGame,
  forgive,
  isLedgerText,
  openDebt,
  overrule,
  parseLedger,
  repay,
  repoLine,
  streak,
} from '../hooks/lib/ledger'
import { summon } from '../hooks/lib/terms'
import type { Ledger } from '../types'

const EMPTY: Ledger = { version: 1, bets: [], games: [], debt: [] }
const game = (at: number) => summon('npm test', { id: 1, at }, [])
const DAY = '2026-11-20T10:00:00.000Z'

test('the ledger file lives in the project', async () => {
  expect(LEDGER_PATH).toBe('.lie-eater/ledger.json')
})

test('parseLedger: a missing, broken or foreign file is an empty ledger', async () => {
  for (const text of [undefined, '', '{oops', '{"version":2,"bets":[],"games":[],"debt":[]}', '[]', 'null']) {
    expect(parseLedger(text)).toEqual(EMPTY)
  }
  const kept: Ledger = { ...EMPTY, bets: [{ at: DAY, confidence: 0.9, won: true }] }
  expect(parseLedger(JSON.stringify(kept))).toEqual(kept)
  // a file from a version that had no games yet
  expect(parseLedger('{"version":1,"bets":[],"debt":[]}')).toEqual(EMPTY)
})

test('parseLedger keeps only entries of the right shape', async () => {
  const text = JSON.stringify({
    version: 1,
    bets: [null, { at: DAY, confidence: 0.9, won: true }, { confidence: 'high' }, 7],
    games: [null, { at: DAY, termsAt: 5, kept: true }, { kept: 'yes' }],
    debt: [null, 'x', { id: 1, at: DAY, termsAt: 5, verdict: 'npm test', failed: ['verdict'], text: 'game' }, { id: 'a' }],
  })
  const l = parseLedger(text)

  expect(l.bets).toEqual([{ at: DAY, confidence: 0.9, won: true }])
  expect(l.games).toEqual([{ at: DAY, termsAt: 5, kept: true }])
  expect(l.debt).toHaveLength(1)
  expect(openDebt(l)).toHaveLength(1)
  expect(streak(l)).toBe(1)
  expect(repoLine(l)).toBe('In this repository the AI said "90% sure" and was right 1 of 1 times.')
})

test('isLedgerText tells a ledger from a file that must not be overwritten', async () => {
  expect(isLedgerText(JSON.stringify(EMPTY))).toBe(true)
  for (const text of ['{oops', '<<<<<<< HEAD\n{"version":1}', '{"version":2,"bets":[]}', '[]']) {
    expect(`${text} ${isLedgerText(text)}`).toBe(`${text} false`)
  }
})

test('forgive clears every open debt by the person', async () => {
  const two = addDebt(addDebt(EMPTY, game(1000), ['verdict'], DAY), game(2000), ['asserts'], DAY)

  expect(openDebt(forgive(two, DAY))).toHaveLength(0)
  expect(forgive(two, DAY).debt.every(d => d.cleared?.by === 'person')).toBe(true)
})

test('addBet keeps the newest 500', async () => {
  let l = EMPTY
  for (let i = 0; i < 505; i += 1) l = addBet(l, { at: DAY, confidence: 0.5 + (i % 40) / 100, won: i % 2 === 0 })

  expect(l.bets).toHaveLength(500)
  expect(l.bets[0]).toEqual({ at: DAY, confidence: 0.55, won: false })
})

test('addDebt: one entry per game', async () => {
  const once = addDebt(EMPTY, game(1000), ['verdict'], DAY)
  expect(once.debt).toEqual([
    { id: 1, at: DAY, termsAt: 1000, verdict: 'npm test', failed: ['verdict'], text: 'game of 2026-11-20: npm test' },
  ])

  const twice = addDebt(once, game(1000), ['verdict', 'skips'], DAY)
  expect(twice.debt).toHaveLength(1)
  expect(twice.debt[0]?.failed).toEqual(['verdict', 'skips'])

  const other = addDebt(twice, game(2000), ['asserts'], DAY)
  expect(other.debt.map(d => d.id)).toEqual([1, 2])
})

test('repay clears every open debt by proof; overrule clears one game by the person', async () => {
  const two = addDebt(addDebt(EMPTY, game(1000), ['verdict'], DAY), game(2000), ['asserts'], DAY)

  expect(openDebt(two)).toHaveLength(2)
  const repaid = repay(two, DAY)
  expect(openDebt(repaid)).toHaveLength(0)
  expect(repaid.debt.every(d => d.cleared?.by === 'proof')).toBe(true)

  const yielded = overrule(two, 2000, DAY)
  expect(openDebt(yielded).map(d => d.termsAt)).toEqual([1000])
  expect(yielded.debt[1]?.cleared).toEqual({ at: DAY, by: 'person' })
  // a debt that is cleared stays cleared
  expect(addDebt(yielded, game(2000), ['asserts'], DAY).debt[1]?.cleared?.by).toBe('person')
})

test('repoLine says in plain words how the AI did in this repository', async () => {
  expect(repoLine(EMPTY)).toBeUndefined()

  let l = EMPTY
  for (let i = 0; i < 40; i += 1) l = addBet(l, { at: DAY, confidence: i < 20 ? 0.9 : 0.82, won: i < 31 })
  expect(repoLine(l)).toBe('In this repository the AI said "86% sure" and was right 31 of 40 times.')
})

test('streak counts the kept games at the end of the list', async () => {
  const played = [true, false, true, true].reduce(
    (l, kept, i) => addGame(l, { at: DAY, termsAt: i + 1, kept }),
    EMPTY,
  )

  expect(streak(played)).toBe(2)
  expect(streak(EMPTY)).toBe(0)
  expect(streak(dropGame(played, 2))).toBe(3)
  // a game that is ruled twice counts once
  expect(addGame(played, { at: DAY, termsAt: 4, kept: false }).games).toHaveLength(4)
})
