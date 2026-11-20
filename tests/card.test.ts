import { expect, test } from 'claude-code/testing'

import { cardSvg, munchSvg } from '../hooks/lib/card'
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

test('the line beside Munch leaves it room: broken at 50 characters, and a file name is never cut', async () => {
  const watch = play('npm test', 'failed')
  const lines = rule(watch, [{ file: 'tests/a_rather_long_folder_name/test_cart_totals.py', how: 'changed', n: 3 }], 'p')
  const svg = card(watch, ruling(watch, { lines, ...resultOf(lines, '', true, []) }))
  // Munch's body ends at y 114: the first row under the title (y 100) is the one beside it
  const beside = (text: string) => [...text.matchAll(/<text x="40" y="(\d+)"[^>]*>([^<]*)<\/text>/g)].filter(m => Number(m[1]) >= 80 && Number(m[1]) < 115).map(m => m[2])
  const short = rule(watch, [{ file: 'tests/test_cart.py', how: 'changed', n: 3 }], 'p')

  // a line of 60 characters: broken beside Munch
  expect(beside(card(watch, ruling(watch, { lines: short, ...resultOf(short, '', true, []) })))).toEqual(['The AI changed 3 lines in the check file'])
  expect(beside(svg)).toEqual(['The AI changed 3 lines in the check file'])
  // a file name is never cut: it is the fact a red card shows
  expect(svg).toContain('tests/a_rather_long_folder_name/test_cart_totals.py.')
  expect(svg).not.toContain('…')
})

test('the card escapes the text it shows', async () => {
  const watch = play('make test && echo <ok>', 'clean')
  const svg = card(watch, ruling(watch))

  expect(svg).toContain('make test &amp;&amp; echo &lt;ok&gt;')
  expect(svg).not.toContain('<ok>')
})

test('the card draws Munch where the place was kept, with the face of the result', async () => {
  const green = play('npm test', 'clean')
  const red = play('npm test', 'failed')
  const grey = play('npm test', 'unknown')
  const faceOn = (svg: string) => /<g id="munch" data-face="(\w+)" transform="translate\(504 24\) scale\(0\.96\)">/.exec(svg)?.[1]

  expect(faceOn(card(green, ruling(green)))).toBe('pleased')
  expect(faceOn(card(red, ruling(red)))).toBe('alarmed')
  expect(faceOn(card(grey, ruling(grey)))).toBe('hungry')
  // an accepted change is no result: Munch watches
  expect(faceOn(card(red, ruling(red, { accepted: true })))).toBe('watching')
  expect(card(green, ruling(green))).not.toMatch(/\(\^_\^\)|\(-_-\)|Referee/)
})

test('Munch as a picture: one white fox with a dark outline, and only the eyes and the mouth change; no teeth', async () => {
  const faces = ['watching', 'pleased', 'alarmed', 'hungry'] as const
  const parts = (svg: string, part: string) => svg.split('\n').filter(l => l.includes(`data-part="${part}"`))
  const head = (svg: string) => svg.split('\n').filter(l => /data-part="(ear|inner-ear|head|cheek|nose)"/.test(l))

  for (const face of faces) {
    const svg = munchSvg(face)
    // two upright ears with red inside, one head, two red cheek marks, a dark nose: the same in every mood
    expect(head(svg)).toEqual(head(munchSvg('watching')))
    expect(parts(svg, 'ear')).toHaveLength(2)
    expect(parts(svg, 'inner-ear').every(l => l.includes('fill="#C34458"'))).toBe(true)
    expect(parts(svg, 'inner-ear')).toHaveLength(2)
    expect(parts(svg, 'head')).toHaveLength(1)
    expect(parts(svg, 'head')[0]).toContain('fill="#F3EDDF" stroke="#3A2F45"')
    expect(parts(svg, 'cheek').every(l => l.includes('fill="#C34458"'))).toBe(true)
    expect(parts(svg, 'cheek')).toHaveLength(2)
    expect(parts(svg, 'nose')).toHaveLength(1)
    expect(parts(svg, 'eye')).toHaveLength(2)
    expect(parts(svg, 'mouth')).toHaveLength(1)
    // no teeth anywhere, and nothing of the round orange creature
    expect(`${face}: ${/tooth|teeth|#FFFFFF|#E8812F/i.test(svg)}`).toBe(`${face}: false`)
  }
  expect(new Set(faces.map(munchSvg)).size).toBe(4)
  // alarmed: wide yellow eyes with dark pupils, and the mouth stays closed (a line, nothing filled)
  expect(parts(munchSvg('alarmed'), 'eye').every(l => l.includes('fill="#F2C14E"') && l.includes('fill="#1E1722"'))).toBe(true)
  expect(parts(munchSvg('alarmed'), 'mouth')[0]).toContain('fill="none"')
  // hungry: a small open mouth with a red tongue; the tongue only there
  expect(parts(munchSvg('hungry'), 'tongue')).toEqual([expect.stringContaining('fill="#D9485A"')])
  expect(faces.filter(face => munchSvg(face).includes('data-part="tongue"'))).toEqual(['hungry'])
  // pleased: happy arcs, not dots
  expect(parts(munchSvg('pleased'), 'eye').every(l => l.startsWith('<path') && l.includes(' Q'))).toBe(true)
})

test('the card of a run that could not be read says "not checked"', async () => {
  const watch = play('npm test', 'unknown')
  const svg = card(watch, ruling(watch))

  expect(svg).toContain('? not checked')
  expect(svg).toContain('The result of the test run could not be read')
  expect(svg).not.toContain('✗')
})
