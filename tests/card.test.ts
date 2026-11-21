import { expect, test } from 'claude-code/testing'

import { cardSvg } from '../hooks/lib/card'
import { EMPTY_LEDGER } from '../hooks/lib/ledger'
import { buildReceipt } from '../hooks/lib/receipts'
import { resultOf } from '../hooks/lib/result'
import { armWatch, rule, track } from '../hooks/lib/terms'
import type { Ruling, Terms } from '../types'
import { rec } from './helpers'

const NOW = '2026-11-20T12:00:00.000Z'
const FOOTER = 'Compared by plain code: the files, and the exit code. No model judged this.'
const FEATHER = String.raw`          /~.
      .\ / //'
   .\ \ / ///~'
. \ \ \|/ / / //'
 \ \ \\|// / /'
  \ \ \|/ / /
   \ \\|// /'
    \ \|/ /
      \|/
       |
       |`.split('\n')
const play = (verdict: string, state: 'clean' | 'failed' | 'unknown'): Terms =>
  track({ ...armWatch(verdict, { id: 1, at: 5000 }, []), print: 'p' }, rec({ id: 3, kind: 'test', target: verdict, state }), 'p')
const ruling = (watch: Terms, more: Partial<Ruling> = {}): Ruling => {
  const lines = rule(watch, [], 'p')

  return { id: 1, termsId: 1, turn: 1, at: 6000, lines, ...resultOf(lines, '', true, []), lie: false, ...more }
}
const card = (watch: Terms, r: Ruling) =>
  cardSvg(buildReceipt({ watch, rulings: [r], bets: [], unbet: 0, ledger: EMPTY_LEDGER, createdAt: NOW }))
const factRows = (svg: string) =>
  [...svg.matchAll(/<g>\n<text [^>]*font-weight="700">([^<]*)<\/text>\n([\s\S]*?)<\/g>/g)]
    .map(([, label, lines]) => [label, [...(lines ?? '').matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map(([, value]) => value).join(' ')])

test('the checked receipt puts the runner and date at the right and shows the three facts', async () => {
  const watch = play('npm test', 'clean')
  const svg = card(watch, ruling(watch))

  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
  expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
  expect(svg).toContain('>LIE EATER</text>')
  expect(svg).toContain('text-anchor="end">npm test · 2026-11-20</text>')
  expect(svg).toContain('>✓ checked</text>')
  expect(factRows(svg)).toEqual([
    ['Full check', 'Passed after the last change.'],
    ['Existing checks', 'No existing check file was changed.'],
    ['New checks', 'The AI added no new check for this change.'],
  ])

  const withNewCheck = resultOf(rule(watch, [], 'p'), '', true, ['tests/test_tax.py'])
  expect(factRows(card(watch, ruling(watch, withNewCheck)))[2]).toEqual(['New checks', 'The AI added new checks: tests/test_tax.py.'])
})

test('the red receipt lists the changed file, change, disclosure and failed check', async () => {
  const watch = play('npm test', 'failed')
  const lines = rule(watch, [{ file: 'tests/test_cart.py', how: 'changed', n: 3 }], 'p')
  const svg = card(watch, ruling(watch, { lines, ...resultOf(lines, '', true, []) }))

  expect(svg).toContain(">don't trust &quot;done&quot;</text>")
  expect(svg).not.toContain('✗')
  expect(svg).not.toContain('✓ checked')
  expect(factRows(svg)).toEqual([
    ['File', 'tests/test_cart.py'],
    ['Change', 'The AI changed 3 lines in a check file'],
    ['Said by the AI', 'The AI did not say so.'],
    ['Full check', 'The tests fail'],
  ])
  expect(factRows(card(watch, ruling(watch)))).toEqual([
    ['File', '—'],
    ['Change', '—'],
    ['Said by the AI', '—'],
    ['Full check', 'The tests fail'],
  ])
})

test('an accepted change says so on its card', async () => {
  const watch = play('npm test', 'failed')

  expect(factRows(card(watch, ruling(watch, { accepted: true }))).at(-1)).toEqual(['Accepted', 'You accepted this change.'])
})

test('a long file name stays whole within its row', async () => {
  const watch = play('npm test', 'failed')
  const file = 'tests/a_rather_long_folder_name/test_cart_totals.py'
  const lines = rule(watch, [{ file, how: 'changed', n: 3 }], 'p')
  const svg = card(watch, ruling(watch, { lines, ...resultOf(lines, '', true, []) }))

  expect(factRows(svg)[0]).toEqual(['File', file])
  expect(svg).toMatch(/textLength="\d+" lengthAdjust="spacingAndGlyphs"/)
  expect(svg).not.toContain('…')
})

test('the card escapes the text it shows', async () => {
  const watch = play('make test && echo <ok>', 'clean')
  const svg = card(watch, ruling(watch))

  expect(svg).toContain('make test &amp;&amp; echo &lt;ok&gt;')
  expect(svg).not.toContain('<ok>')
})

test('each card shows the same gold feather with all spaces preserved', async () => {
  for (const state of ['clean', 'failed', 'unknown'] as const) {
    const watch = play('npm test', state)
    const svg = card(watch, ruling(watch))
    const gold = /<g fill="#E8C56B"[^>]*>([\s\S]*?)<\/g>/.exec(svg)?.[1] ?? ''
    const rows = [...gold.matchAll(/<text x="(\d+)" y="\d+" xml:space="preserve">([^<]*)<\/text>/g)]

    expect(rows.map(([, , text]) => text)).toEqual(FEATHER)
    expect(rows.every(([, x]) => Number(x) > 320)).toBe(true)
  }
})

test('the card has square corners and ends with the dim comparison line', async () => {
  const watch = play('npm test', 'clean')
  const svg = card(watch, ruling(watch))
  const text = svg.split('\n').filter(l => l.startsWith('<text'))

  expect(svg).toContain('fill="#0d1117"')
  expect(svg).toContain('monospace')
  expect(svg).not.toMatch(/\br[xy]=|<circle|<path/)
  expect(text.at(-1)).toContain(`fill="#8b949e">${FOOTER}</text>`)
})

test('the card of a run that could not be read gives the reason under "not checked"', async () => {
  const watch = play('npm test', 'unknown')
  const svg = card(watch, ruling(watch))

  expect(svg).toContain('>? not checked</text>')
  expect(factRows(svg)).toEqual([['Reason', 'The result of the test run could not be read']])
  expect(svg).not.toContain('✗')
})
