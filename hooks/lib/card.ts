// The card: the newest result as a picture, written as SVG text (no library),
// so that a person can post it or put it in a README.
import type { Receipt } from './receipts'

const W = 640
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const C = { bg: '#0d1117', line: '#30363d', text: '#e6edf3', dim: '#8b949e', faint: '#6e7681', good: '#3fb950', bad: '#f85149', note: '#d29922' }
const COLOUR = { checked: C.good, distrust: C.bad, unchecked: C.note } as const

// The place kept for a character (the owner wants one later): a square at the
// top right. It is empty now; draw the character inside this group.
const CHARACTER = { x: W - 136, y: 24, size: 96 }

const esc = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

// A line of the person's screen, broken at its sentences (and, when one is still too long, between words): never cut.
function wrap(text: string, max: number): string[] {
  if (text.length <= max) return [text]

  return text.split(/(?<=\.) /).flatMap(sentence =>
    sentence.split(' ').reduce<string[]>((rows, word) => {
      const last = rows.at(-1)

      return last !== undefined && `${last} ${word}`.length <= max ? [...rows.slice(0, -1), `${last} ${word}`] : [...rows, word]
    }, []),
  )
}

function line(x: number, y: number, text: string, opts: { size?: number; fill?: string; weight?: string; anchor?: string; space?: number } = {}): string {
  const { size = 15, fill = C.text, weight = '400', anchor = 'start', space = 0 } = opts

  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${
    space === 0 ? '' : ` letter-spacing="${space}"`
  }>${esc(text)}</text>`
}

/** The newest result of a receipt as a card: the person's three lines, then the evidence in short. */
export function cardSvg(receipt: Receipt): string {
  const last = receipt.results.at(-1)
  const [title = 'No result yet', ...said] = last?.screen ?? []
  const colour = last === undefined || last.accepted === true ? C.dim : COLOUR[last.result]
  const bets =
    receipt.score === null
      ? 'No bet was placed.'
      : `The AI said "${Math.round(receipt.score.said * 100)}% sure". It was right ${receipt.score.won} of ${receipt.score.n} times.`

  const body: string[] = []
  let y = 100

  for (const text of [...said, ...(last?.accepted === true ? ['You accepted this change.'] : [])].flatMap(t => wrap(t, 60))) {
    body.push(line(40, y, cut(text, 60), { size: 15 }))
    y += 26
  }
  body.push(line(40, y, cut(`${receipt.check.command} · ${receipt.createdAt.slice(0, 10)}`, 66), { size: 13, fill: C.dim }))
  y += 40
  for (const l of last?.lines ?? []) {
    const mark = l.unclear === true ? '?' : l.pass ? '✓' : '✗'
    const fill = mark === '✓' ? C.good : mark === '?' ? C.note : C.bad
    body.push(line(40, y, mark, { size: 15, fill, weight: '700' }))
    body.push(line(64, y, cut(l.plain, 60), { size: 14, fill: C.dim }))
    y += 24
  }

  const H = Math.max(320, y + 80)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Lie Eater: ${title}`)}">`,
    `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="14" fill="${C.bg}" stroke="${C.line}" stroke-width="2"/>`,
    `<g id="character" transform="translate(${CHARACTER.x} ${CHARACTER.y})" data-size="${CHARACTER.size}"></g>`,
    line(40, 34, 'LIE EATER', { size: 13, fill: C.dim, weight: '700', space: 4 }),
    line(40, 70, title, { size: 32, fill: colour, weight: '700' }),
    ...body,
    `<line x1="40" y1="${H - 64}" x2="${W - 40}" y2="${H - 64}" stroke="${C.line}" stroke-width="1"/>`,
    line(40, H - 36, bets, { size: 13 }),
    line(W - 40, H - 14, 'Lie Eater checks the proof before you believe it.', { size: 11, fill: C.faint, anchor: 'end' }),
    '</svg>',
    '',
  ].join('\n')
}
