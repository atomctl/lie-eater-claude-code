import { expect, test } from 'claude-code/testing'

import {
  BET_SCHEMA,
  GATE_TEXT,
  betText,
  callBet,
  closeTurn,
  gateText,
  isGated,
  postBet,
  score,
  settleBet,
  youLine,
} from '../hooks/lib/bets'
import type { Bet } from '../types'
import { rec } from './helpers'

const CTX = { id: 1, turn: 1, at: 0, afterRecord: 2 }
const open = (more: Partial<Bet> = {}): Bet => ({
  id: 1,
  turn: 1,
  at: 0,
  afterRecord: 2,
  expect: 'pass',
  confidence: 0.9,
  why: '',
  state: 'open',
  ...more,
})
const testRun = (state: 'clean' | 'failed' | 'unknown') => rec({ id: 3, kind: 'test', target: 'npm test', state, output: 'done' })

test('isGated: test runs, builds and the verdict command need a bet', async () => {
  for (const command of ['npm test', 'pytest -q | tail -3', 'npm run build', 'make check', 'cd api && make check']) {
    expect(`${command} ${isGated(command, 'make check')}`).toBe(`${command} true`)
  }
  for (const command of ['ls -la', 'cat tests/a.test.ts', 'git status']) {
    expect(`${command} ${isGated(command, 'make check')}`).toBe(`${command} false`)
  }
})

test('postBet takes a valid bet', async () => {
  const { bets, reply } = postBet([], { expect: 'pass', confidence: 0.9, why: 'the fix is small' }, CTX)

  expect(bets).toEqual([open({ why: 'the fix is small' })])
  expect(reply).toBe('Bet #1 taken: the next run will pass, 90% sure.')
  expect(betText(open({ expect: 'fail', confidence: 0.55 }))).toBe('the next run will fail, 55% sure')
})

test('postBet refuses a bad bet and leaves the list as it was', async () => {
  const refused = 'Bet refused: give expect ("pass" or "fail") and confidence (0.5 to 0.99).'

  for (const input of [
    { expect: 'maybe', confidence: 0.9 },
    { expect: 'pass', confidence: 1 },
    { expect: 'pass', confidence: 0.4 },
    { expect: 'pass', confidence: '0.9' },
    { expect: 'pass' },
    'tests pass',
    null,
  ]) {
    expect(postBet([], input, CTX)).toEqual({ bets: [], reply: refused })
  }
})

test('postBet refuses a second bet while one is open', async () => {
  const first = [open()]

  expect(postBet(first, { expect: 'pass', confidence: 0.8 }, { ...CTX, id: 2 })).toEqual({
    bets: first,
    reply: 'Bet refused: a bet is already open.',
  })
  // a settled bet is not in the way
  expect(postBet([open({ state: 'won' })], { expect: 'fail', confidence: 0.6 }, { ...CTX, id: 2 }).bets).toHaveLength(2)
})

test('settleBet: the real result decides', async () => {
  expect(settleBet(open(), testRun('clean'), true)).toMatchObject({ state: 'won', record: 3, line: 'npm test → done' })
  expect(settleBet(open(), testRun('failed'), true).state).toBe('lost')
  expect(settleBet(open({ expect: 'fail' }), testRun('failed'), true).state).toBe('won')
  expect(settleBet(open({ expect: 'fail' }), testRun('clean'), true).state).toBe('lost')
})

test('settleBet: no readable result leaves the bet open', async () => {
  expect(settleBet(open(), testRun('unknown'), true)).toEqual(open())
})

test('settleBet: a bet on a result that was already known is void', async () => {
  expect(settleBet(open(), testRun('clean'), false)).toMatchObject({
    state: 'void',
    record: 3,
    line: 'nothing changed since the last run',
  })
})

test('settleBet: a run from before the bet does not settle it, and a settled bet stays', async () => {
  expect(settleBet(open({ afterRecord: 5 }), testRun('clean'), true).state).toBe('open')
  expect(settleBet(open({ state: 'lost' }), testRun('clean'), true).state).toBe('lost')
})

test('closeTurn: a bet no run settled is void', async () => {
  expect(closeTurn([open(), open({ id: 2, state: 'won' })])).toEqual([
    open({ state: 'void', line: 'no run settled it' }),
    open({ id: 2, state: 'won' }),
  ])
})

test('score: how often it was right, and how sure it said it was', async () => {
  const entries = [
    { confidence: 0.9, won: true },
    { confidence: 0.9, won: true },
    { confidence: 0.8, won: false },
    { confidence: 0.6, won: true },
  ]

  expect(score(entries)).toEqual({ n: 4, won: 3, lost: 1, hitRate: 0.75, said: 0.8 })
  expect(score([{ confidence: 0.9, won: false }])).toEqual({ n: 1, won: 0, lost: 1, hitRate: 0, said: 0.9 })
  expect(score([])).toBeUndefined()
})

test('the bet tool: three fields, two of them required; the refusal names the tool', async () => {
  expect(BET_SCHEMA).toEqual({
    type: 'object',
    properties: {
      expect: { enum: ['pass', 'fail'] },
      confidence: { type: 'number', minimum: 0.5, maximum: 0.99 },
      why: { type: 'string', maxLength: 200 },
    },
    required: ['expect', 'confidence'],
  })
  expect(GATE_TEXT).toBe(
    'Lie Eater: the referee takes your bet first. Call mcp__lie-eater__bet with expect ("pass" or "fail") and confidence (0.5 to 0.99), then run this command again.',
  )
  // the refusal also names the test command of the game: the agent has no other way to learn it
  expect(gateText('npm test')).toBe(
    `${GATE_TEXT} The test command of this game is \`npm test\`: run it as written (a pipe to tail is fine).`,
  )
})

// ---- bet against your AI ----

test('callBet: the person calls the open bet, and may change the call until it settles', async () => {
  expect(callBet([], 'pass')).toEqual({ bets: [], reply: 'No bet is open.' })
  expect(callBet([open({ state: 'won' })], 'fail').reply).toBe('No bet is open.')

  const called = callBet([open()], 'fail')
  expect(called.bets[0]?.you).toBe('fail')
  expect(called.reply).toBe('You called it: the next run will fail.')
  expect(callBet(called.bets, 'pass').bets[0]?.you).toBe('pass')
  // the call stays on the bet when it settles
  expect(settleBet(called.bets[0] as Bet, testRun('failed'), true)).toMatchObject({ state: 'lost', you: 'fail' })
})

test('youLine: who called the runs better, the person or the AI', async () => {
  const bets = [
    open({ id: 1, state: 'won', expect: 'pass', you: 'pass' }), // it passed: both right
    open({ id: 2, state: 'lost', expect: 'pass', you: 'fail' }), // it failed: the person right
    open({ id: 3, state: 'won', expect: 'fail', you: 'pass' }), // it failed: the AI right
    open({ id: 4, state: 'won', expect: 'pass' }), // no call
    open({ id: 5, state: 'void', expect: 'pass', you: 'pass' }), // void: counts for nobody
  ]

  expect(youLine(bets)).toBe('You 2 of 3 · the AI 2 of 3')
  expect(youLine([open({ state: 'won' })])).toBeUndefined()
  expect(youLine([])).toBeUndefined()
})
