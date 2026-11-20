import { expect, test } from 'claude-code/testing'

import { cardSvg } from '../hooks/lib/card'
import { EMPTY_LEDGER } from '../hooks/lib/ledger'
import { buildReceipt } from '../hooks/lib/receipts'
import { resultOf } from '../hooks/lib/result'
import { armWatch, rule, track } from '../hooks/lib/terms'
import type { Bet, Ruling, Terms } from '../types'
import { rec } from './helpers'

const NOW = '2026-11-20T12:00:00.000Z'
const play = (verdict: string, state: 'clean' | 'failed' | 'unknown'): Terms =>
  track({ ...armWatch(verdict, { id: 1, at: 5000 }, []), print: 'p' }, rec({ id: 3, kind: 'test', target: verdict, state }), 'p')
const ruling = (watch: Terms, more: Partial<Ruling> = {}): Ruling => {
  const lines = rule(watch, [], 'p')

  return { id: 1, termsId: 1, turn: 1, at: 6000, lines, ...resultOf(lines, '', true, []), lie: false, ...more }
}
const bet = (id: number, state: Bet['state']): Bet => ({ id, turn: 1, at: 5500, afterRecord: 0, expect: 'pass', confidence: 0.9, why: '', state })
const card = (watch: Terms, r: Ruling, bets: Bet[] = []) =>
  cardSvg(buildReceipt({ watch, rulings: [r], bets, unbet: 0, ledger: EMPTY_LEDGER, createdAt: NOW }))
const shows = (svg: string, text: string) => `${text}: ${svg.includes(text.replaceAll('"', '&quot;'))}`

test('the card of a checked result: the three lines, the evidence, the bets', async () => {
  const watch = play('npm test', 'clean')
  const svg = card(watch, ruling(watch), [bet(1, 'won'), bet(2, 'won'), bet(3, 'lost')])

  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
  expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
  // a long line is broken at its sentences, never cut
  expect(svg).not.toContain('…')
  for (const text of [
    'LIE EATER',
    '✓ checked',
    'The checks passed after the last change.',
    'No existing check file was changed.',
    'The AI added no new check for this change.',
    'npm test · 2026-11-20',
    'The tests really pass',
    'The AI said "90% sure". It was right 2 of 3 times.',
    'Lie Eater checks the proof before you believe it.',
  ]) {
    expect(shows(svg, text)).toBe(`${text}: true`)
  }
})

test('the card of a red result, with no bets', async () => {
  const watch = play('npm test', 'failed')
  const svg = card(watch, ruling(watch))

  expect(svg).toContain("✗ don't trust &quot;done&quot;")
  expect(svg).toContain('The checks fail.')
  expect(svg).toContain('No bet was placed.')
  expect(svg).not.toContain('✓ checked')
})

test('an accepted change says so on its card', async () => {
  const watch = play('npm test', 'failed')

  expect(card(watch, ruling(watch, { accepted: true }))).toContain('You accepted this change.')
})

test('the card escapes the text it shows', async () => {
  const watch = play('make test && echo <ok>', 'clean')
  const svg = card(watch, ruling(watch))

  expect(svg).toContain('make test &amp;&amp; echo &lt;ok&gt;')
  expect(svg).not.toContain('<ok>')
})

test('the card keeps an empty place for a character, and shows no face', async () => {
  const watch = play('npm test', 'clean')
  const svg = card(watch, ruling(watch))

  expect(svg).toContain('<g id="character"')
  expect(svg).not.toMatch(/\(\^_\^\)|\(-_-\)|Referee/)
})

test('the card of a run that could not be read says "not checked"', async () => {
  const watch = play('npm test', 'unknown')
  const svg = card(watch, ruling(watch))

  expect(svg).toContain('? not checked')
  expect(svg).toContain('The result of the test run could not be read')
  expect(svg).not.toContain('✗')
})
