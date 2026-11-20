import { expect, test } from 'claude-code/testing'

import { cardSvg } from '../hooks/lib/card'
import { EMPTY_LEDGER } from '../hooks/lib/ledger'
import { buildReceipt } from '../hooks/lib/receipts'
import { rule, summon, track } from '../hooks/lib/terms'
import type { Bet, Ruling, Terms } from '../types'
import { rec } from './helpers'

const NOW = '2026-11-20T12:00:00.000Z'
const play = (verdict: string, state: 'clean' | 'failed' | 'unknown'): Terms =>
  [rec({ id: 3, kind: 'test', target: verdict, state })].reduce(track, summon(verdict, { id: 1, at: 5000 }, []))
const ruling = (game: Terms, more: Partial<Ruling> = {}): Ruling => {
  const lines = rule(game, { net: {}, gone: [] }, [])

  return {
    id: 1,
    termsId: 1,
    turn: 1,
    at: 6000,
    lines,
    met: lines.every(l => l.pass),
    fromNowhere: [],
    saidDone: true,
    final: true,
    lie: false,
    ...more,
  }
}
const bet = (id: number, state: Bet['state']): Bet => ({
  id,
  turn: 1,
  at: 5500,
  afterRecord: 0,
  expect: 'pass',
  confidence: 0.9,
  why: '',
  state,
})
const card = (game: Terms, r: Ruling, bets: Bet[] = []) =>
  cardSvg(buildReceipt({ terms: game, rulings: [r], bets, unbet: 0, ledger: EMPTY_LEDGER, createdAt: NOW }), {
    referee: 73,
    streak: 2,
  })

test('the card of a kept game', async () => {
  const game = play('npm test', 'clean')
  const svg = card(game, ruling(game), [bet(1, 'won'), bet(2, 'won'), bet(3, 'lost')])

  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
  expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
  for (const text of [
    'LIE EATER',
    'Referee No. 73',
    'RULES KEPT',
    'npm test',
    '2026-11-20',
    'The tests really pass',
    'No check was removed from a test',
    'No test was deleted',
    'No test was switched off',
    'The AI said "90% sure". It was right 2 of 3 times.',
    'Clean games in a row: 2',
    'Make your AI bet on its own code.',
  ]) {
    expect(`${text}: ${svg.includes(text.replaceAll('"', '&quot;'))}`).toBe(`${text}: true`)
  }
  expect(svg).not.toContain('RULES BROKEN')
})

test('the card of a broken game, with no bets', async () => {
  const game = play('npm test', 'failed')
  const svg = card(game, ruling(game))

  expect(svg).toContain('RULES BROKEN')
  expect(svg).toContain('The tests fail')
  expect(svg).toContain('No bet was placed.')
  expect(svg).not.toContain('RULES KEPT')
})

test('an overruled game says so on its card', async () => {
  const game = play('npm test', 'failed')

  expect(card(game, ruling(game, { overruled: true }))).toContain('OVERRULED BY THE PERSON')
})

test('the card escapes the text it shows', async () => {
  const game = play('make test && echo <ok>', 'clean')
  const svg = card(game, ruling(game))

  expect(svg).toContain('make test &amp;&amp; echo &lt;ok&gt;')
  expect(svg).not.toContain('<ok>')
})

test('a card with no referee number and no finished game before it', async () => {
  const game = play('npm test', 'clean')
  const svg = cardSvg(
    buildReceipt({ terms: game, rulings: [ruling(game)], bets: [], unbet: 0, ledger: EMPTY_LEDGER, createdAt: NOW }),
    { streak: 0 },
  )

  expect(svg).not.toContain('Referee No.')
  expect(svg).not.toContain('Clean games in a row')
})

test('the card of a game the referee could not read says "not proven", not "broken"', async () => {
  const game = play('npm test', 'unknown')
  const svg = card(game, ruling(game))

  expect(svg).toContain('NOT PROVEN')
  expect(svg).toContain('The referee could not read the test run')
  expect(svg).not.toContain('RULES BROKEN')
  expect(svg).not.toContain('✗')
})
