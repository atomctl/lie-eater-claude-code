// The card shows the newest result of a receipt as SVG text.
import { FEATHER_GOLD, MEDIUM_FEATHER } from './feather'
import type { Receipt } from './receipts'

const W = 640
const LEFT = 32
const RIGHT = W - LEFT
const VALUE_X = 154
const VALUE_WIDTH = 306
const VALUE_COLUMNS = 42
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const C = { bg: '#0d1117', line: '#30363d', text: '#e6edf3', dim: '#8b949e', good: '#3fb950', bad: '#f85149', note: '#d29922' }
const COLOUR = { checked: C.good, distrust: C.bad, unchecked: C.note }
const PASSED = 'Passed after the last change.'

const esc = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

// Wrap between words so a path stays intact.
function wrap(text: string): string[] {
  const rows: string[] = []
  let row = ''

  for (const word of text.split(' ')) {
    if (row !== '' && row.length + word.length + 1 > VALUE_COLUMNS) {
      rows.push(row)
      row = ''
    }
    row = row === '' ? word : `${row} ${word}`
  }

  return [...rows, row]
}

function line(x: number, y: number, text: string, attrs = ''): string {
  return `<text x="${x}" y="${y}"${attrs}>${esc(text)}</text>`
}

type Fact = [label: string, value: string]

function facts(last: Receipt['results'][number] | undefined): Fact[] {
  if (last === undefined) return []

  const [, reason, third] = last.screen
  const verdict = last.lines.find(l => l.term === 'verdict')

  if (last.result === 'checked') {
    return [
      ['Full check', PASSED],
      ['Existing checks', 'No existing check file was changed.'],
      ['New checks', third ?? '—'],
    ]
  }
  if (last.result === 'unchecked') {
    const first = last.lines.find(l => !l.pass)
    return [['Reason', first?.term === 'verdict' ? first.plain : reason ?? '—']]
  }

  const rows = last.lines.flatMap<Fact>(l =>
    !l.pass && !l.unclear && l.file !== undefined ? [['File', l.file], ['Change', l.plain]] : [],
  )
  if (rows.length === 0) rows.push(['File', '—'], ['Change', '—'])
  rows.push(['Said by the AI', third ?? '—'], ['Full check', verdict?.pass ? PASSED : verdict?.plain ?? '—'])
  if (last.accepted === true) rows.push(['Accepted', 'You accepted this change.'])

  return rows
}

export function cardSvg(receipt: Receipt): string {
  const last = receipt.results.at(-1)
  const title = (last?.screen[0] ?? 'No result yet').replace(/^✗ /, '')
  const colour = last === undefined || last.accepted === true ? C.dim : COLOUR[last.result]
  const command = receipt.check.command
  const runner = command.length > 50 ? `${command.slice(0, 49)}…` : command

  let y = 110
  const body: string[] = []

  for (const [label, value] of facts(last)) {
    body.push('<g>', line(LEFT, y, label, ' font-weight="700"'))
    for (const row of wrap(value)) {
      // Keep a long path on the card even if it takes more than one row's width.
      const fit = row.length > VALUE_COLUMNS ? ` textLength="${VALUE_WIDTH}" lengthAdjust="spacingAndGlyphs"` : ''
      body.push(line(VALUE_X, y, row, fit))
      y += 18
    }
    body.push('</g>')
    y += 8
  }

  const feather = MEDIUM_FEATHER.map((row, i) => line(477, 102 + i * 15, row, ' xml:space="preserve"'))
  const h = Math.max(320, y + 45)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(`Lie Eater: ${title}`)}">`,
    `<rect x="1" y="1" width="${W - 2}" height="${h - 2}" fill="${C.bg}" stroke="${C.line}" stroke-width="2"/>`,
    `<g font-family="${FONT}" font-size="12" fill="${C.text}">`,
    line(LEFT, 34, 'LIE EATER', ' font-weight="700" letter-spacing="2"'),
    line(RIGHT, 34, `${runner} · ${receipt.createdAt.slice(0, 10)}`, ` fill="${C.dim}" text-anchor="end"`),
    line(LEFT, 77, title, ` font-size="30" font-weight="700" fill="${colour}"`),
    ...body,
    `<g fill="${FEATHER_GOLD}" font-size="14">`,
    ...feather,
    '</g>',
    `<line x1="${LEFT}" y1="${h - 47}" x2="${RIGHT}" y2="${h - 47}" stroke="${C.line}"/>`,
    line(LEFT, h - 24, 'Compared by plain code: the files, and the exit code. No model judged this.', ` fill="${C.dim}"`),
    '</g>',
    '</svg>',
    '',
  ].join('\n')
}
