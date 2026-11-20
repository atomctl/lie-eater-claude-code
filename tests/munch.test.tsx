// Munch, the face of the result in the pane: pixel art of block characters,
// the plain art in a narrow pane, and Munch's line under the result lines.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { COLOURS, PIXELS, PIXEL_COLUMNS, PLAIN, faceRows } from '../hooks/lib/munch'
import type { Face } from '../hooks/lib/result'
import { MATH, PANE, betRun, done, editCode, project, start, world } from './kit'

const FACES: Face[] = ['watching', 'pleased', 'alarmed', 'hungry']
const passing = () => ({ result: {}, text: '34 passed in 1s' })
const SKIPPED = MATH.replace("it('adds'", "it.skip('adds'")
const rowText = (face: Face) => faceRows(face).map(spans => spans.map(s => s.text).join(''))

test('the four faces: three text rows of at most 14 blocks, one body, only the eyes and the mouth change', async () => {
  const outline = (face: Face) => PIXELS[face].map(row => row.replace(/[ODW]/g, '#'))

  for (const face of FACES) {
    expect(PIXELS[face]).toHaveLength(6)
    expect(faceRows(face)).toHaveLength(3)
    expect(rowText(face).every(row => row.length <= 14 && /^[ █▀▄]+$/.test(row))).toBe(true)
    expect(outline(face)).toEqual(outline('watching'))
    // the eyes and the mouth stay inside the body: its edge is body colour all round
    for (const [r, row] of PIXELS[face].entries()) {
      const inside = row.replace(/^\.+|\.+$/g, '')
      const edge = r === 0 || r === 5 ? inside : `${inside.at(0)}${inside.at(-1)}`

      expect(`${face} ${r}: ${/^O+$/.test(edge)}`).toBe(`${face} ${r}: true`)
    }
  }
  // every eye and tooth pixel has body all round it: nothing depends on the terminal's background
  for (const face of FACES) {
    const px = PIXELS[face]
    const open = px.flatMap((row, r) => [...row].flatMap((p, c) => (p === 'D' || p === 'W') && [px[r - 1]?.[c], px[r + 1]?.[c], row[c - 1], row[c + 1]].some(n => n === undefined || n === '.') ? [`${face} ${r},${c}`] : []))

    expect(open).toEqual([])
  }
  // dark eyes in every face; white teeth under the closed mouth and in an open one, none in the smile
  expect(FACES.filter(face => PIXELS[face].join('').includes('W'))).toEqual(['watching', 'alarmed', 'hungry'])
  expect(FACES.every(face => PIXELS[face].slice(1, 3).join('').includes('D'))).toBe(true)
  expect(new Set(FACES.map(face => PIXELS[face].join('\n'))).size).toBe(4)
})

test('a face is drawn two pixels to a character, in the three colours only', async () => {
  const { O, D, W } = COLOURS

  // ▀ draws the top pixel in its colour and the bottom pixel in its background
  expect(faceRows('watching')).toEqual([
    [{ text: ' ' }, { text: '▄▄', color: O }, { text: '▀', color: O, backgroundColor: D }, { text: '███', color: O }, { text: '▀', color: O, backgroundColor: D }, { text: '▄▄', color: O }, { text: ' ' }],
    [{ text: '██', color: O }, { text: '▀▀▀▀▀▀▀', color: O, backgroundColor: D }, { text: '██', color: O }],
    [{ text: ' ' }, { text: '▀██', color: O }, { text: '▀', color: W, backgroundColor: O }, { text: '█', color: O }, { text: '▀', color: W, backgroundColor: O }, { text: '██▀', color: O }, { text: ' ' }],
  ])
  const used = new Set(FACES.flatMap(face => faceRows(face).flat().flatMap(s => [s.color, s.backgroundColor])))
  used.delete(undefined)
  expect([...used].sort()).toEqual(Object.values(COLOURS).sort())
})

test('the plain art, for a pane too narrow for the pixel art', async () => {
  expect(PIXEL_COLUMNS).toBe(40)
  expect(PLAIN).toEqual({
    watching: [' .----.', '( o  o )', '(  --  )', " `----'"],
    pleased: [' .----.', '( ^  ^ )', '( \\__/ )', " `----'"],
    alarmed: [' .----.', '( O  O )', '( \\/\\/ )', " `----'"],
    hungry: [' .----.', '( o  o )', '(  ()  )', " `----'"],
  })
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
    words: words === undefined ? [] : kids(words).filter(isNode).map(n => ({ text: textOf(n), dim: n.props?.dimColor === true })),
  }
}

test('the pane before any result: the watching face, and at its right the intro and Munch\'s line, dim', async ($, on) => {
  world(on, project())
  on('tool.call', passing)
  await start($)

  expect(await topRow($)).toEqual({
    face: rowText('watching'),
    words: [
      { text: 'When the AI says "done", Lie Eater checks the proof: the checks must pass, and none may be removed or switched off.', dim: false },
      { text: '"Nothing to eat yet."', dim: true },
    ],
  })
})

test('a hidden changed check: the alarmed face, the three result lines as they are, then "You lied. I ate it."', async ($, on) => {
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

test('green with no new check: the pleased face and its line', async ($, on) => {
  world(on, project())
  on('tool.call', passing)
  await start($)
  await editCode($)
  await betRun($, 'npm test')
  await done($)

  expect(await topRow($)).toMatchObject({ face: rowText('pleased'), words: expect.arrayContaining([{ text: '"Green. Nothing new got tested."', dim: true }]) })
})

test('a project with no checks: the hungry face', async ($, on) => {
  world(on, { files: {}, dirs: { tests: [] } })
  await start($)

  expect(await topRow($)).toEqual({
    face: rowText('hungry'),
    words: [
      { text: '? not checked', dim: false },
      { text: 'This project has no checks yet.', dim: false },
      { text: '"No checks here. Nothing to bite."', dim: true },
    ],
  })
})

test(`a pane narrower than ${PIXEL_COLUMNS} columns draws the plain art`, async ($, on) => {
  world(on, project())
  await start($)

  expect((await topRow($, PIXEL_COLUMNS - 1)).face).toEqual(PLAIN.watching)
  expect((await topRow($, PIXEL_COLUMNS)).face).toEqual(rowText('watching'))
})
