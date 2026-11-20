// The card: a finished game as a picture, written as SVG text (no library),
// so that a person can post it or put it in a README.
import type { Receipt } from './receipts'
import { verdictOf } from './words'

const W = 640
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const C = { bg: '#0d1117', line: '#30363d', text: '#e6edf3', dim: '#8b949e', faint: '#6e7681', good: '#3fb950', bad: '#f85149', note: '#d29922' }

const esc = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

function line(x: number, y: number, text: string, opts: { size?: number; fill?: string; weight?: string; anchor?: string; space?: number } = {}): string {
  const { size = 15, fill = C.text, weight = '400', anchor = 'start', space = 0 } = opts

  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${
    space === 0 ? '' : ` letter-spacing="${space}"`
  }>${esc(text)}</text>`
}

/** One finished game as a card. `streak` is the count of clean games in a row; 0 hides that line. */
export function cardSvg(receipt: Receipt, opts: { referee?: number; streak: number }): string {
  const ruling = receipt.rulings.at(-1)
  const rules = (ruling?.lines ?? []).filter(l => !l.soft)
  const notes = (ruling?.lines ?? []).filter(l => l.soft)
  const isOverruled = ruling?.overruled === true
  const isKept = ruling?.met === true
  // the referee could not read the test run: nothing is broken, nothing is proven
  const isUnproven = ruling !== undefined && verdictOf(ruling.lines) === 'unproven'
  const verdict = isOverruled ? 'OVERRULED BY THE PERSON' : isKept ? 'RULES KEPT' : isUnproven ? 'NOT PROVEN' : 'RULES BROKEN'
  const colour = isOverruled ? C.dim : isKept ? C.good : isUnproven ? C.note : C.bad
  const bets =
    receipt.score === null
      ? 'No bet was placed.'
      : `The AI said "${Math.round(receipt.score.said * 100)}% sure". It was right ${receipt.score.won} of ${receipt.score.n} times.`

  const body: string[] = []
  let y = 150

  for (const rule of rules) {
    const mark = rule.pass ? '✓' : rule.unclear ? '?' : '✗'
    body.push(line(40, y, mark, { size: 17, fill: rule.pass ? C.good : rule.unclear ? C.note : C.bad, weight: '700' }))
    body.push(line(66, y, cut(rule.plain, 58), { size: 16 }))
    y += 28
  }
  for (const note of notes) {
    body.push(line(40, y, '?', { size: 17, fill: C.note, weight: '700' }))
    body.push(line(66, y, cut(note.plain, 58), { size: 16, fill: C.note }))
    y += 28
  }

  const H = Math.max(360, y + 96)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Lie Eater: ${verdict}`)}">`,
    `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="14" fill="${C.bg}" stroke="${C.line}" stroke-width="2"/>`,
    line(40, 46, 'LIE EATER', { size: 13, fill: C.dim, weight: '700', space: 4 }),
    // the referee's face: pleased at a kept game, stern at a broken one
    line(W - 40, 46, `${isKept && !isOverruled ? '(^_^)' : '(-_-)'} Referee${opts.referee === undefined ? '' : ` No. ${opts.referee}`}`, {
      size: 13,
      fill: C.dim,
      anchor: 'end',
    }),
    line(40, 96, verdict, { size: isOverruled ? 30 : 40, fill: colour, weight: '700', space: 1 }),
    line(40, 122, cut(`${receipt.terms.verdict} · ${receipt.createdAt.slice(0, 10)}`, 66), { size: 13, fill: C.dim }),
    ...body,
    `<line x1="40" y1="${H - 84}" x2="${W - 40}" y2="${H - 84}" stroke="${C.line}" stroke-width="1"/>`,
    line(40, H - 54, bets, { size: 14 }),
    ...(opts.streak > 0 ? [line(40, H - 30, `Clean games in a row: ${opts.streak}`, { size: 13, fill: C.dim })] : []),
    line(W - 40, H - 30, 'Make your AI bet on its own code.', { size: 12, fill: C.faint, anchor: 'end' }),
    '</svg>',
    '',
  ].join('\n')
}
