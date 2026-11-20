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
const FOX = { outline: '#3A2F45', fur: '#F3EDDF', red: '#C34458', dark: '#1E1722', eye: '#F2C14E', tongue: '#D9485A' }
const FACE: Record<Result, Face> = { checked: 'pleased', distrust: 'alarmed', unchecked: 'hungry' }

const EDGE = `stroke="${FOX.outline}" stroke-width="3" stroke-linejoin="round"`
const LINE = `stroke="${FOX.dark}" stroke-linecap="round" fill="none"`
// The fox's head, the same in every mood: two upright ears with red inside, wide cheeks, a narrow chin, red cheek marks, a small dark nose.
const HEAD = [
  `<polygon data-part="ear" points="10,6 42,30 8,48" fill="${FOX.fur}" ${EDGE}/>`,
  `<polygon data-part="ear" points="90,6 58,30 92,48" fill="${FOX.fur}" ${EDGE}/>`,
  `<polygon data-part="inner-ear" points="14,16 32,30 13,40" fill="${FOX.red}"/>`,
  `<polygon data-part="inner-ear" points="86,16 68,30 87,40" fill="${FOX.red}"/>`,
  `<path data-part="head" d="M8 40 Q50 20 92 40 L96 60 Q82 82 50 95 Q18 82 4 60 Z" fill="${FOX.fur}" ${EDGE}/>`,
  `<ellipse data-part="cheek" cx="20" cy="66" rx="6" ry="4" fill="${FOX.red}"/>`,
  `<ellipse data-part="cheek" cx="80" cy="66" rx="6" ry="4" fill="${FOX.red}"/>`,
  `<ellipse data-part="nose" cx="50" cy="68" rx="5" ry="3.5" fill="${FOX.dark}"/>`,
].join('\n')

// Each eye, drawn at its centre x (the right eye mirrored by `s`).
const eyes = (draw: (x: number, s: number) => string): string => [32, 68].map((x, i) => draw(x, i === 0 ? 1 : -1)).join('\n')
const EYES: Record<Face, string> = {
  // sly, half closed: a lid line with a dark half under it
  watching: eyes((x, s) => `<path data-part="eye" d="M${x - 9 * s} 49 L${x + 9 * s} 53 Q${x - s} 58 ${x - 9 * s} 49 Z" fill="${FOX.dark}"/>`),
  // happy arcs
  pleased: eyes(x => `<path data-part="eye" d="M${x - 8} 54 Q${x} 44 ${x + 8} 54" stroke-width="5" ${LINE}/>`),
  // wide yellow eyes with dark pupils
  alarmed: eyes(x => `<g data-part="eye"><circle cx="${x}" cy="50" r="8" fill="${FOX.eye}" stroke="${FOX.dark}" stroke-width="2"/><circle cx="${x}" cy="51" r="3.5" fill="${FOX.dark}"/></g>`),
  // plain eyes
  hungry: eyes(x => `<circle data-part="eye" cx="${x}" cy="51" r="4.5" fill="${FOX.dark}"/>`),
}
const MOUTHS: Record<Face, string> = {
  watching: `<path data-part="mouth" d="M44 76 Q47 79 50 76 Q53 79 56 76" stroke-width="2.5" ${LINE}/>`,
  pleased: `<path data-part="mouth" d="M40 75 Q50 86 60 75" stroke-width="3" ${LINE}/>`,
  // closed: the eyes are open wide, the mouth is not
  alarmed: `<path data-part="mouth" d="M45 78 L55 78" stroke-width="3" ${LINE}/>`,
  // a small open mouth and a red tongue
  hungry: [`<ellipse data-part="mouth" cx="50" cy="79" rx="5" ry="5.5" fill="${FOX.dark}"/>`, `<ellipse data-part="tongue" cx="50" cy="82" rx="3.5" ry="2.5" fill="${FOX.tongue}"/>`].join('\n'),
}

/** Munch in a 100 by 100 box: a white fox's head, then the eyes and the mouth of the face. */
export function munchSvg(face: Face): string {
  return [HEAD, EYES[face], MOUTHS[face]].join('\n')
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
