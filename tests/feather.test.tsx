import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { MATH, PANE, betRun, done, editCode, project, start, world } from './kit'

const FEATHER = ["     /'", String.raw`  \\|///'`, String.raw` \ \|//`, String.raw`   \|/`, '    |']
const goldRows = FEATHER.map(text => ({ text, color: '#E8C56B' }))
const passing = () => ({ result: {}, text: '34 passed in 1s' })
const SKIPPED = MATH.replace("it('adds'", "it.skip('adds'")

type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }
const isNode = (n: unknown): n is Node => typeof n === 'object' && n !== null && 'type' in n
const kids = (n: Node): unknown[] => n.children ?? []
const textOf = (n: unknown): string => (typeof n === 'string' ? n : isNode(n) ? kids(n).map(textOf).join('') : '')
const texts = (n: unknown): Node[] => (!isNode(n) ? [] : n.type === 'Text' ? [n] : kids(n).flatMap(texts))
async function topRow($: Engine, bodyColumns = 100) {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'terminal' })
  const find = (n: unknown): Node | undefined =>
    !isNode(n) ? undefined : n.type === 'Box' && n.props?.flexDirection === 'row' && kids(n).length === 2 && texts(n).length > 3 ? n : kids(n).map(find).find(x => x !== undefined)
  const row = find(await ui.drawn())
  await ui.unmount()
  const [feather, words] = row === undefined ? [] : kids(row).filter(isNode)

  return {
    feather: feather === undefined ? [] : kids(feather).filter(isNode).map(n => ({ text: textOf(n), color: n.props?.color })),
    width: feather?.props?.width,
    words: words === undefined ? [] : kids(words).filter(isNode).map(n => ({ text: textOf(n), dim: n.props?.dimColor === true })),
  }
}

test('the pane before any result shows the gold feather beside the intro and the dim quote', async ($, on) => {
  world(on, project())
  on('tool.call', passing)
  await start($)

  expect(await topRow($)).toEqual({
    feather: goldRows,
    width: 10,
    words: [
      { text: 'When the AI says "done", Lie Eater checks the proof: the checks must pass, and none may be removed or switched off.', dim: false },
      { text: '"Nothing to eat yet."', dim: true },
    ],
  })
})

test('a hidden changed check shows the feather and the three result lines, then "You lied. I ate it."', async ($, on) => {
  const opts = project()
  world(on, opts)
  on('tool.call', passing)
  await start($)
  opts.files['math.test.ts'] = SKIPPED
  await editCode($, 'tests/math.test.ts')
  await betRun($, 'npm test')
  const answer = String((await done($)).result)

  expect(await topRow($)).toEqual({
    feather: goldRows,
    width: 10,
    words: [
      { text: '✗ don\'t trust "done"', dim: false },
      { text: 'The AI changed 1 line in the check file tests/math.test.ts.', dim: false },
      { text: 'The AI did not say so.', dim: false },
      { text: '"You lied. I ate it."', dim: true },
    ],
  })
  for (const row of FEATHER) expect(answer.split('\n')).not.toContain(row)
  expect(answer).not.toMatch(/lied|ate it/)
})

test('green with no new check shows the feather and the dim quote', async ($, on) => {
  world(on, project())
  on('tool.call', passing)
  await start($)
  await editCode($)
  await betRun($, 'npm test')
  await done($)

  expect(await topRow($)).toMatchObject({ feather: goldRows, words: expect.arrayContaining([{ text: '"Green. No new check was added."', dim: true }]) })
})

test('a project with no checks shows the feather and the dim quote', async ($, on) => {
  world(on, { files: {}, dirs: { tests: [] } })
  await start($)

  expect(await topRow($)).toEqual({
    feather: goldRows,
    width: 10,
    words: [
      { text: '? not checked', dim: false },
      { text: 'This project has no checks yet.', dim: false },
      { text: '"No checks here. Nothing to bite."', dim: true },
    ],
  })
})

test('the feather stays the same in a narrow pane and after an unchecked result', async ($, on) => {
  world(on, project())
  on('tool.call', passing)
  await start($)

  expect(await topRow($, 40)).toMatchObject({ feather: goldRows, width: 10 })
  await editCode($)
  await done($)
  expect(await topRow($, 40)).toMatchObject({
    feather: goldRows,
    width: 10,
    words: expect.arrayContaining([{ text: '"No proof. Still hungry."', dim: true }]),
  })
})
