import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { SMALL_EYE } from '../hooks/lib/eye'
import { MATH, PANE, betRun, done, editCode, project, start, world } from './kit'

const goldRows = SMALL_EYE.map(text => ({ text, color: '#E8C56B' }))
const passing = () => ({ result: {}, text: '34 passed in 1s' })
const SKIPPED = MATH.replace("it('adds'", "it.skip('adds'")

type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }
const isNode = (n: unknown): n is Node => typeof n === 'object' && n !== null && 'type' in n
const kids = (n: Node | undefined): Node[] => (n?.children ?? []).filter(isNode)
const textOf = (n: unknown): string => (typeof n === 'string' ? n : isNode(n) ? (n.children ?? []).map(textOf).join('') : '')
async function topRow($: Engine, bodyColumns = 100) {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'terminal' })
  const [row] = kids(await ui.drawn() as Node)
  await ui.unmount()
  expect(row?.props?.flexDirection).toBe('row')
  const blocks = kids(row)
  const eye = blocks.length === 2 ? blocks[0] : undefined
  const result = blocks.at(-1)

  return {
    eye: kids(eye).map(n => ({ text: textOf(n), color: n.props?.color })),
    eyeWidth: eye?.props?.width,
    resultWidth: result?.props?.width,
    words: kids(result).map(n => ({ text: textOf(n), dim: n.props?.dimColor === true })),
  }
}

test('the pane before any result shows the five gold eye lines beside the intro and the dim quote', async ($, on) => {
  world(on, project())
  on('tool.call', passing)
  await start($)

  const top = await topRow($)
  expect(top.eye).toHaveLength(5)
  expect(top).toEqual({
    eye: goldRows,
    eyeWidth: 32,
    resultWidth: 68,
    words: [
      { text: 'When the AI says "done", Lie Eater checks the proof: the checks must pass, and none may be removed or switched off.', dim: false },
      { text: '"Nothing to eat yet."', dim: true },
    ],
  })
})

test('a hidden changed check shows the eye and the three result lines, then "You lied. I ate it."', async ($, on) => {
  const opts = project()
  world(on, opts)
  on('tool.call', passing)
  await start($)
  opts.files['math.test.ts'] = SKIPPED
  await editCode($, 'tests/math.test.ts')
  await betRun($, 'npm test')
  const answer = String((await done($)).result)

  expect(await topRow($)).toEqual({
    eye: goldRows,
    eyeWidth: 32,
    resultWidth: 68,
    words: [
      { text: '✗ don\'t trust "done"', dim: false },
      { text: 'The AI changed 1 line in the check file tests/math.test.ts.', dim: false },
      { text: 'The AI did not say so.', dim: false },
      { text: '"You lied. I ate it."', dim: true },
    ],
  })
  for (const row of SMALL_EYE) expect(answer.split('\n')).not.toContain(row)
  expect(answer).not.toMatch(/lied|ate it/)
})

test('green with no new check shows the eye and the dim quote', async ($, on) => {
  world(on, project())
  on('tool.call', passing)
  await start($)
  await editCode($)
  await betRun($, 'npm test')
  await done($)

  expect(await topRow($)).toMatchObject({ eye: goldRows, words: expect.arrayContaining([{ text: '"Green. No new check was added."', dim: true }]) })
})

test('a project with no checks shows the eye and the dim quote', async ($, on) => {
  world(on, { files: {}, dirs: { tests: [] } })
  await start($)

  expect(await topRow($)).toEqual({
    eye: goldRows,
    eyeWidth: 32,
    resultWidth: 68,
    words: [
      { text: '? not checked', dim: false },
      { text: 'This project has no checks yet.', dim: false },
      { text: '"No checks here. Nothing to bite."', dim: true },
    ],
  })
})

test('below 72 body columns the result uses the full width and the eye is hidden', async ($, on) => {
  world(on, project())
  on('tool.call', passing)
  await start($)

  await editCode($)
  await done($)
  const words = [
    { text: '? not checked', dim: false },
    { text: 'The full check was not run after the last change.', dim: false },
    { text: '"No proof. Still hungry."', dim: true },
  ]
  expect(await topRow($, 72)).toEqual({ eye: goldRows, eyeWidth: 32, resultWidth: 40, words })
  expect(await topRow($, 71)).toEqual({ eye: [], eyeWidth: undefined, resultWidth: 71, words })
  expect(await topRow($, 40)).toEqual({ eye: [], eyeWidth: undefined, resultWidth: 40, words })
})
