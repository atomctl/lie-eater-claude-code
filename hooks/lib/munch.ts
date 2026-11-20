// Munch, the face of the result in the pane: a white fox in pixel art of block
// characters, two pixels to a character (the top half and the bottom half).
// Plain code decides the result (result.ts `munchOf` picks the face); Munch only shows it.
import type { Face } from './result'

/** A white fox with a dark outline, so it holds on a dark and a light terminal. */
export const COLOURS = {
  o: '#3A2F45', // outline
  f: '#F3EDDF', // fur
  r: '#C34458', // inner ears, cheeks
  m: '#1E1722', // eyes, nose, mouth
  e: '#F2C14E', // wide-open eyes
  g: '#D9485A', // tongue
} as const

/**
 * Ten pixel rows (five text rows), sixteen wide: the owner's fox. Only the
 * eyes and the mouth change; the alarmed mouth stays closed. `.` is nothing.
 */
export const PIXELS: Record<Face, readonly string[]> = {
  watching: ['.oo..........oo.', 'ofro........orfo', 'offfoooooooofffo', 'offffffffffffffo', 'ofmmffffffffmmfo', 'offfmmffffmmfffo', '.orffffmmffffro.', '..offfffmmmffo..', '....offffffo....', '......oooo......'],
  pleased: ['.oo..........oo.', 'ofro........orfo', 'offfoooooooofffo', 'offffffffffffffo', 'offmmffffffmmffo', 'ofmffmffffmffmfo', '.orffffmmffffro.', '..offmffffmffo..', '....ofmmmmfo....', '......oooo......'],
  alarmed: ['.oo..........oo.', 'ofro........orfo', 'offfoooooooofffo', 'offffffffffffffo', 'ofeeeffffffeeefo', 'ofemeffffffemefo', '.orffffmmffffro.', '..offfmmmmfffo..', '....offffffo....', '......oooo......'],
  hungry: ['.oo..........oo.', 'ofro........orfo', 'offfoooooooofffo', 'offffffffffffffo', 'offffffffffffffo', 'offmmffffffmmffo', '.orffffmmffffro.', '..offffmmffffo..', '....offggffo....', '......oooo......'],
}

/** The plain fox, for a pane too narrow for the pixel art: the eyes and the mouth tell the mood. */
export const PLAIN: Record<Face, readonly string[]> = {
  watching: ['/\\_____/\\', '( -   - )', ' \\  .  /', '  \\___/'],
  pleased: ['/\\_____/\\', '( ^   ^ )', ' \\  w  /', '  \\___/'],
  alarmed: ['/\\_____/\\', '( O   O )', ' \\  -  /', '  \\___/'],
  hungry: ['/\\_____/\\', '( o   o )', ' \\  O  /', '  \\___/'],
}

/** The width of the face's box, with one column of gap: the pixel fox, and the plain one. */
export const FACE_WIDTH = { pixel: 17, plain: 10 } as const

/** Below this many columns the pane draws the plain fox: the pixel face and its gap take 17, the result lines keep 28. */
export const PIXEL_COLUMNS = 45

export type Span = { text: string; color?: string; backgroundColor?: string }

const paint = (p: string | undefined): string | undefined => (p === undefined || p === '.' ? undefined : COLOURS[p as keyof typeof COLOURS])

// One character for a top and a bottom pixel.
function cell(top: string | undefined, bottom: string | undefined): Span {
  const [t, b] = [paint(top), paint(bottom)]

  if (t === undefined && b === undefined) return { text: ' ' }
  if (t === undefined) return { text: '▄', color: b as string }
  if (b === undefined) return { text: '▀', color: t }
  if (t === b) return { text: '█', color: t }

  return { text: '▀', color: t, backgroundColor: b }
}

/** The face as five text rows, each a list of spans; neighbours of one style are one span. */
export function faceRows(face: Face): Span[][] {
  const px = PIXELS[face]

  return px
    .filter((_, r) => r % 2 === 0)
    .map((_, i) =>
      [...(px[2 * i] ?? '')]
        .map((top, c) => cell(top, px[2 * i + 1]?.[c]))
        .reduce<Span[]>((spans, s) => {
          const last = spans.at(-1)

          return last !== undefined && last.color === s.color && last.backgroundColor === s.backgroundColor
            ? [...spans.slice(0, -1), { ...last, text: last.text + s.text }]
            : [...spans, s]
        }, []),
    )
}
