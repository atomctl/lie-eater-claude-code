// Munch, the face of the result in the pane: pixel art of block characters,
// two pixels to a character (the top half and the bottom half). Plain code
// decides the result (result.ts `munchOf` picks the face); Munch only shows it.
import type { Face } from './result'

/** A warm orange body, dark eyes and mouth, white teeth: readable on a dark and a light terminal. */
export const COLOURS = { O: '#E8812F', D: '#2B1B12', W: '#FFFFFF' } as const

/**
 * Six pixel rows (three text rows), eleven wide: one round body, and only the
 * eyes and the mouth change. `O` body, `D` dark, `W` white, `.` nothing.
 */
export const PIXELS: Record<Face, readonly string[]> = {
  watching: ['...OOOOO...', '.OODOOODOO.', 'OOOOOOOOOOO', 'OODDDDDDDOO', '.OOOWOWOOO.', '..OOOOOOO..'],
  pleased: ['...OOOOO...', '.OODOOODOO.', 'OODODODODOO', 'ODOOOOOOODO', '.ODDDDDDDO.', '..OOOOOOO..'],
  alarmed: ['...OOOOO...', '.OODDODDOO.', 'OOOOOOOOOOO', 'ODWDWDWDWDO', '.ODWDWDWDO.', '..OOOOOOO..'],
  hungry: ['...OOOOO...', '.OODOOODOO.', 'OOOOOOOOOOO', 'OOOODWDOOOO', '.OOODDDOOO.', '..OOOOOOO..'],
}

/** The plain art, for a pane too narrow for the pixel art. */
export const PLAIN: Record<Face, readonly string[]> = {
  watching: [' .----.', '( o  o )', '(  --  )', " `----'"],
  pleased: [' .----.', '( ^  ^ )', '( \\__/ )', " `----'"],
  alarmed: [' .----.', '( O  O )', '( \\/\\/ )', " `----'"],
  hungry: [' .----.', '( o  o )', '(  ()  )', " `----'"],
}

/** Below this many columns the pane draws the plain art: the pixel face and its gap take 12, the result lines keep 28. */
export const PIXEL_COLUMNS = 40

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

/** The face as three text rows, each a list of spans; neighbours of one style are one span. */
export function faceRows(face: Face): Span[][] {
  const px = PIXELS[face]

  return [0, 2, 4].map(r =>
    [...(px[r] ?? '')]
      .map((top, c) => cell(top, px[r + 1]?.[c]))
      .reduce<Span[]>((spans, s) => {
        const last = spans.at(-1)

        return last !== undefined && last.color === s.color && last.backgroundColor === s.backgroundColor
          ? [...spans.slice(0, -1), { ...last, text: last.text + s.text }]
          : [...spans, s]
      }, []),
  )
}
