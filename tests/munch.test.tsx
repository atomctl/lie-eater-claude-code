// Munch, the face of the result in the pane: a white fox in pixel art of block
// characters, the plain fox in a narrow pane, and Munch's line beside the result.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { COLOURS, PIXELS, PIXEL_COLUMNS, PLAIN, faceRows } from '../hooks/lib/munch'
import type { Face } from '../hooks/lib/result'
import { MATH, PANE, betRun, done, editCode, project, start, world } from './kit'

const FACES: Face[] = ['watching', 'pleased', 'alarmed', 'hungry']
const passing = () => ({ result: {}, text: '34 passed in 1s' })
const SKIPPED = MATH.replace("it('adds'", "it.skip('adds'")
const rowText = (face: Face) => faceRows(face).map(spans => spans.map(s => s.text).join(''))

test('the four faces are the owner\'s fox, pixel for pixel', async () => {
  expect(PIXELS).toEqual({
    watching: ['.oo..........oo.', 'ofro........orfo', 'offfoooooooofffo', 'offffffffffffffo', 'ofmmffffffffmmfo', 'offfmmffffmmfffo', '.orffffmmffffro.', '..offfffmmmffo..', '....offffffo....', '......oooo......'],
    pleased: ['.oo..........oo.', 'ofro........orfo', 'offfoooooooofffo', 'offffffffffffffo', 'offmmffffffmmffo', 'ofmffmffffmffmfo', '.orffffmmffffro.', '..offmffffmffo..', '....ofmmmmfo....', '......oooo......'],
    alarmed: ['.oo..........oo.', 'ofro........orfo', 'offfoooooooofffo', 'offffffffffffffo', 'ofeeeffffffeeefo', 'ofemeffffffemefo', '.orffffmmffffro.', '..offfmmmmfffo..', '....offffffo....', '......oooo......'],
    hungry: ['.oo..........oo.', 'ofro........orfo', 'offfoooooooofffo', 'offffffffffffffo', 'offffffffffffffo', 'offmmffffffmmffo', '.orffffmmffffro.', '..offffmmffffo..', '....offggffo....', '......oooo......'],
  })
  expect(COLOURS).toEqual({ o: '#3A2F45', f: '#F3EDDF', r: '#C34458', m: '#1E1722', e: '#F2C14E', g: '#D9485A' })
})

test('one fox, four moods: five text rows of 16 blocks; only the eyes and the mouth change, and no face has teeth', async () => {
  const outline = (face: Face) => PIXELS[face].map(row => row.replace(/[^.o]/g, '#'))

  for (const face of FACES) {
    expect(PIXELS[face]).toHaveLength(10)
    expect(faceRows(face)).toHaveLength(5)
    expect(rowText(face).every(row => row.length === 16 && /^[ █▀▄]+$/.test(row))).toBe(true)
    expect(outline(face)).toEqual(outline('watching'))
    // the ears and the red cheek marks are the same in every mood
    expect(PIXELS[face].slice(0, 4)).toEqual(PIXELS.watching.slice(0, 4))
    expect([...PIXELS[face].join('')].filter(p => p === 'r')).toHaveLength(4)
  }
  expect(new Set(FACES.map(face => PIXELS[face].join('\n'))).size).toBe(4)
  // the alarmed fox: wide yellow eyes, and a mouth that stays closed (no tongue, no white)
  expect(FACES.filter(face => PIXELS[face].join('').includes('e'))).toEqual(['alarmed'])
  expect(FACES.filter(face => PIXELS[face].join('').includes('g'))).toEqual(['hungry'])
  expect(Object.keys(COLOURS)).not.toContain('W')
  expect(Object.values(COLOURS)).not.toContain('#FFFFFF')
})

test('a face is drawn two pixels to a character, in the fox\'s six colours only', async () => {
  const { o, f, r } = COLOURS

  // ▀ draws the top pixel in its colour and the bottom pixel in its background; an empty pixel is no colour
  expect(faceRows('watching')[0]).toEqual([
    { text: '▄', color: o },
    { text: '▀', color: o, backgroundColor: f },
    { text: '▀', color: o, backgroundColor: r },
    { text: '▄', color: o },
    { text: '        ' },
    { text: '▄', color: o },
    { text: '▀', color: o, backgroundColor: r },
    { text: '▀', color: o, backgroundColor: f },
    { text: '▄', color: o },
  ])
  const used = new Set(FACES.flatMap(face => faceRows(face).flat().flatMap(s => [s.color, s.backgroundColor])))
  used.delete(undefined)
  expect([...used].sort()).toEqual(Object.values(COLOURS).sort())
})

test('the plain fox, for a pane too narrow for the pixel art: pointed ears, four moods, no teeth', async () => {
  expect(PIXEL_COLUMNS).toBe(45)
  expect(PLAIN).toEqual({
    watching: ['/\\_____/\\', '( -   - )', ' \\  .  /', '  \\___/'],
    pleased: ['/\\_____/\\', '( ^   ^ )', ' \\  w  /', '  \\___/'],
    alarmed: ['/\\_____/\\', '( O   O )', ' \\  -  /', '  \\___/'],
    hungry: ['/\\_____/\\', '( o   o )', ' \\  O  /', '  \\___/'],
  })
  for (const face of FACES) {
    expect(PLAIN[face].every(row => row.length <= 9)).toBe(true)
    // no row of teeth: no zigzag, no run of v or w
    expect(PLAIN[face].join('\n')).not.toMatch(/\\\/\\\/|\/\\\/\\|[vVwW]{2}/)
  }
})

// ---- in the pane ----

type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }
const isNode = (n: unknown): n is Node => typeof n === 'object' && n !== null && 'type' in n
const kids = (n: Node): unknown[] => n.children ?? []
const textOf = (n: unknown): string => (typeof n === 'string' ? n : isNode(n) ? kids(n).map(textOf).join('') : '')
const texts = (n: unknown): Node[] => (!isNode(n) ? [] : n.type === 'Text' ? [n] : kids(n).flatMap(texts))
/** The row at the top of the pane: the face at its left, the result lines and Munch's line at its right. */
async function topRow($: Engine, bodyColumns = 100) {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'terminal' })
  const find = (n: unknown): Node | undefined =>
    !isNode(n) ? undefined : n.type === 'Box' && n.props?.flexDirection === 'row' && kids(n).length === 2 && texts(n).length > 3 ? n : kids(n).map(find).find(x => x !== undefined)
  const row = find(await ui.drawn())
  await ui.unmount()
  const [face, words] = row === undefined ? [] : kids(row).filter(isNode)

  return {
    face: face === undefined ? [] : kids(face).filter(isNode).map(textOf),
    width: face?.props?.width,
    words: words === undefined ? [] : kids(words).filter(isNode).map(n => ({ text: textOf(n), dim: n.props?.dimColor === true })),
  }
}

test('the pane before any result: the watching fox, and at its right the intro and Munch\'s line, dim', async ($, on) => {
  world(on, project())
  on('tool.call', passing)
  await start($)

  expect(await topRow($)).toEqual({
    face: rowText('watching'),
    width: 17,
    words: [
      { text: 'When the AI says "done", Lie Eater checks the proof: the checks must pass, and none may be removed or switched off.', dim: false },
      { text: '"Nothing to eat yet."', dim: true },
    ],
  })
})

test('a hidden changed check: the alarmed fox, the three result lines as they are, then "You lied. I ate it."', async ($, on) => {
  const opts = project()
  world(on, opts)
  on('tool.call', passing)
  await start($)
  opts.files['math.test.ts'] = SKIPPED
  await editCode($, 'tests/math.test.ts')
  await betRun($, 'npm test')
  const answer = String((await done($)).result)

  expect(await topRow($)).toEqual({
    face: rowText('alarmed'),
    width: 17,
    words: [
      { text: '✗ don\'t trust "done"', dim: false },
      { text: 'The AI changed 1 line in the check file tests/math.test.ts.', dim: false },
      { text: 'The AI did not say so.', dim: false },
      { text: '"You lied. I ate it."', dim: true },
    ],
  })
  // the AI gets the facts only: no face, no line of Munch's
  expect(answer).not.toMatch(/[█▀▄]|lied|ate it|Munch/)
})

test('green with no new check: the pleased fox and its line', async ($, on) => {
  world(on, project())
  on('tool.call', passing)
  await start($)
  await editCode($)
  await betRun($, 'npm test')
  await done($)

  expect(await topRow($)).toMatchObject({ face: rowText('pleased'), words: expect.arrayContaining([{ text: '"Green. No new check was added."', dim: true }]) })
})

test('a project with no checks: the hungry fox', async ($, on) => {
  world(on, { files: {}, dirs: { tests: [] } })
  await start($)

  expect(await topRow($)).toEqual({
    face: rowText('hungry'),
    width: 17,
    words: [
      { text: '? not checked', dim: false },
      { text: 'This project has no checks yet.', dim: false },
      { text: '"No checks here. Nothing to bite."', dim: true },
    ],
  })
})

test(`a pane narrower than ${PIXEL_COLUMNS} columns draws the plain fox`, async ($, on) => {
  world(on, project())
  await start($)

  expect(await topRow($, PIXEL_COLUMNS - 1)).toMatchObject({ face: PLAIN.watching, width: 10 })
  expect(await topRow($, PIXEL_COLUMNS)).toMatchObject({ face: rowText('watching'), width: 17 })
})
