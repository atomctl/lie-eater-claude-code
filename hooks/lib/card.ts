// The card: the newest result as a picture, written as SVG text (no library),
// so that a person can post it or put it in a README.
import type { Result } from '../../types'
import type { Receipt } from './receipts'
import type { Face } from './result'

const W = 640
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const C = { bg: '#0d1117', line: '#30363d', text: '#e6edf3', dim: '#8b949e', faint: '#6e7681', good: '#3fb950', bad: '#f85149', note: '#d29922' }
const COLOUR = { checked: C.good, distrust: C.bad, unchecked: C.note } as const

// Munch, the face of the result: a square at the top right.
const CHARACTER = { x: W - 136, y: 24, size: 96 }
const MUNCH = { body: '#E8812F', shine: '#F4A462', dark: '#2B1B12', white: '#FFFFFF' }
const FACE: Record<Result, Face> = { checked: 'pleased', distrust: 'alarmed', unchecked: 'hungry' }

const eyes = (draw: (x: number) => string): string => [34, 66].map(draw).join('\n')
const PLAIN_EYES = eyes(x => `<circle data-part="eye" cx="${x}" cy="38" r="5" fill="${MUNCH.dark}"/>`)
const EYES: Record<Face, string> = {
  watching: PLAIN_EYES,
  hungry: PLAIN_EYES,
  pleased: eyes(x => `<path data-part="eye" d="M${x - 7} 41 Q${x} 31 ${x + 7} 41" stroke="${MUNCH.dark}" stroke-width="5" stroke-linecap="round" fill="none"/>`),
  alarmed: eyes(x => `<g data-part="eye"><circle cx="${x}" cy="35" r="9" fill="${MUNCH.white}"/><circle cx="${x}" cy="36" r="5" fill="${MUNCH.dark}"/></g>`),
}
const tooth = (points: string): string => `<polygon data-part="tooth" points="${points}" fill="${MUNCH.white}"/>`
const MOUTHS: Record<Face, string> = {
  watching: [`<rect data-part="mouth" x="22" y="62" width="56" height="6" rx="3" fill="${MUNCH.dark}"/>`, tooth('40,67 48,67 44,75'), tooth('52,67 60,67 56,75')].join('\n'),
  pleased: [
    `<path data-part="mouth" d="M20 58 Q50 88 80 58" stroke="${MUNCH.dark}" stroke-width="6" stroke-linecap="round" fill="none"/>`,
    tooth('37,73 46,76 42,84'),
    tooth('54,76 63,73 58,84'),
  ].join('\n'),
  alarmed: [
    `<path data-part="mouth" d="M16 53 Q50 47 84 53 Q80 88 50 88 Q20 88 16 53 Z" fill="${MUNCH.dark}"/>`,
    ...[0, 1, 2, 3, 4, 5, 6].map(i => tooth(`${22 + 8 * i},52 ${30 + 8 * i},52 ${26 + 8 * i},62`)),
    ...[0, 1, 2, 3].map(i => tooth(`${34 + 8 * i},84 ${42 + 8 * i},84 ${38 + 8 * i},75`)),
  ].join('\n'),
  hungry: [`<ellipse data-part="mouth" cx="50" cy="68" rx="10" ry="9" fill="${MUNCH.dark}"/>`, tooth('45,60 55,60 50,67')].join('\n'),
}

/** Munch in a 100 by 100 box: one round body, then the eyes and the mouth of the face. */
export function munchSvg(face: Face): string {
  return [
    `<ellipse cx="50" cy="54" rx="44" ry="40" fill="${MUNCH.body}"/>`,
    `<ellipse cx="34" cy="26" rx="12" ry="5" fill="${MUNCH.shine}"/>`,
    EYES[face],
    MOUTHS[face],
  ].join('\n')
}

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
  const isResult = last !== undefined && last.accepted !== true
  const colour = isResult ? COLOUR[last.result] : C.dim
  // An accepted change is no result: Munch watches.
  const face: Face = isResult ? FACE[last.result] : 'watching'
  const bets =
    receipt.score === null
      ? 'No bet was placed.'
      : `The AI said "${Math.round(receipt.score.said * 100)}% sure". It was right ${receipt.score.won} of ${receipt.score.n} times.`

  const body: string[] = []
  let y = 100

  // The person's lines run beside Munch: 50 characters leave it room.
  for (const text of [...said, ...(last?.accepted === true ? ['You accepted this change.'] : [])].flatMap(t => wrap(t, 50))) {
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
    `<g id="munch" data-face="${face}" transform="translate(${CHARACTER.x} ${CHARACTER.y}) scale(${CHARACTER.size / 100})">`,
    munchSvg(face),
    '</g>',
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
