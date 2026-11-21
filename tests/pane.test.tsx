// The pane gets out of the way: the feather and the result, one row of buttons,
// one dim hint; Details only when asked; closed at the person's next prompt.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { DEMO_FILES } from '../hooks/lib/demo'
import { MATH, PANE, bash, betRun, detailLines, done, editCode, paneLines, project, prompt, run, start, world } from './kit'

const passing = () => ({ result: {}, text: '34 passed in 1s' })
const RED = '✗ don\'t trust "done"'
const SKIPPED = MATH.replace("it('adds'", "it.skip('adds'")
const HINT_RED = 'Press f or a, or type /check or /accept.'
const HINT_CHECK = 'Press c, or type /check.'
const HINT_DETAILS = 'Press d, or type /lie-eater details.'
const DEMO_HINT_ROW = 'Lie Eater: "Now type /check, or press f. The AI puts the check back and fixes the bug."'
const CAUGHT = 'Lie Eater: "The checks were green both times. The first time a check had been changed to get there."'

type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }
const isNode = (n: unknown): n is Node => typeof n === 'object' && n !== null && 'type' in n
const kids = (n: Node): Node[] => (n.children ?? []).filter(isNode)
const textOf = (n: unknown): string => (typeof n === 'string' ? n : isNode(n) ? (n.children ?? []).map(textOf).join('') : '')
const rowsOf = (text: string, columns: number) => Math.max(1, Math.ceil(text.length / columns))

/**
 * The rows the pane's body takes at the kit's width, as a terminal wraps them:
 * the top block is as tall as the feather or the wrapped lines beside it, a row
 * of buttons is one row, a Text wraps at the body's width.
 */
async function bodyRows($: Engine, bodyColumns = PANE.props.bodyColumns): Promise<number> {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'terminal' })
  const root = await ui.drawn()
  await ui.unmount()

  return kids(root as Node).reduce((rows, child) => {
    const [feather, words] = kids(child)
    if (child.type === 'Box' && child.props?.flexDirection === 'row' && feather !== undefined && words !== undefined && typeof feather.props?.width === 'number') {
      const room = bodyColumns - feather.props.width
      return rows + Math.max(kids(feather).length, kids(words).reduce((n, line) => n + rowsOf(textOf(line), room), 0))
    }

    return rows + (child.type === 'Text' ? rowsOf(textOf(child), bodyColumns) : 1)
  }, 0)
}

/** The default pane: at most 7 rows, no Details, and the hint as its last row. */
async function small($: Engine, hint: string) {
  const lines = await paneLines($)

  expect(await bodyRows($)).toBeLessThanOrEqual(7)
  expect(lines.at(-1)).toBe(hint)
  expect(lines.filter(l => l === 'Details' || l.startsWith('Full check:') || l.startsWith('Calls recorded') || l === 'No tool calls yet.')).toEqual([])
}

test('the default pane before any result: the feather and the intro, the d button, the Details hint; no Details', async ($, on) => {
  world(on, project())
  await start($)

  await small($, HINT_DETAILS)
})

test('the default pane of a red result: at most 7 rows, the two buttons and d in one row, the hint naming Details', async ($, on) => {
  const opts = project()
  world(on, opts)
  on('tool.call', passing)
  await start($)
  opts.files['math.test.ts'] = SKIPPED
  await editCode($, 'tests/math.test.ts')
  await betRun($, 'npm test')
  await done($)

  await small($, HINT_RED)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const row = (await ui.findAll({ type: 'Box' })).find(box => box.children.some(c => isNode(c) && c.type === 'Button'))
  await ui.unmount()
  expect(row?.children.filter(isNode).filter(c => c.type === 'Button').map(c => c.props?.hotkey)).toEqual(['f', 'a', 'd'])
})

test('the default pane of "not checked", then of green', async ($, on) => {
  const opts = project()
  world(on, opts)
  on('tool.call', passing)
  await start($)
  await editCode($)
  await done($)
  await small($, HINT_CHECK)
  await betRun($, 'npm test')
  await done($)
  await small($, HINT_DETAILS)
})

test('the default pane of a project with no checks', async ($, on) => {
  world(on, { files: {}, dirs: { tests: [] } })
  await start($)

  await small($, HINT_CHECK)
})

test('/lie-eater details opens the pane with Details under the top block; /lie-eater opens it without', async ($, on) => {
  const seen = world(on, project())
  on('tool.call', passing)
  await start($)
  await betRun($, 'npm test')

  expect((await run($, 'lie-eater', 'details')).text).toBe('Lie Eater pane opened, with Details.')
  expect(seen.opens).toBe(1)
  const lines = await paneLines($)
  expect(lines).toEqual(expect.arrayContaining(['Details', 'Full check: npm test', '#1 test ✓ npm test']))
  // Details come after the result, the buttons and the hint
  expect(lines.indexOf('Details')).toBeGreaterThan(lines.indexOf(HINT_DETAILS))

  expect((await run($, 'lie-eater')).text).toBe('Lie Eater pane opened.')
  expect(await paneLines($)).not.toContain('Full check: npm test')
})

test('d in the pane shows Details and hides them again', async ($, on) => {
  world(on, project())
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'details' }))?.props).toMatchObject({ hotkey: 'd', label: 'Details' })
  await ui.press({ key: 'details' })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toContain('Full check: npm test')
  expect((await ui.find({ key: 'details' }))?.props).toMatchObject({ hotkey: 'd', label: 'Hide details' })
  await ui.press({ key: 'details' })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).not.toContain('Full check: npm test')
  await ui.unmount()
})

test('the pane closes at the person\'s next prompt, not at a prompt the mod sends or a command of the mod', async ($, on) => {
  const opts = project()
  const seen = world(on, opts)
  on('tool.call', passing)
  await start($)
  opts.files['math.test.ts'] = SKIPPED
  await editCode($, 'tests/math.test.ts')
  await betRun($, 'npm test')
  await done($)
  expect(seen.opens).toBe(1)

  // the repair button: the mod sends its own prompt, as the person
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'repair' })
  await ui.unmount()
  await seen.tick()
  expect(seen.prompts).toHaveLength(1)
  // the person types a command of the mod; a background task reports
  await $.prompt.submit({ text: '/lie-eater details', command: { name: 'lie-eater', args: 'details' }, origin: { kind: 'composer' }, wait: false } as never)
  await $.prompt.submit({ text: 'task done', origin: { kind: 'task-notification' }, wait: false } as never)
  // a prompt the mod sends, as the engine stamps it
  await $.prompt.submit({ text: 'Run the full check.', origin: { kind: 'plugin', name: 'lie-eater', asUser: true }, wait: false } as never)
  expect(seen.closes).toEqual([])

  await run($, 'lie-eater', 'details')
  await prompt($, 'thanks, now the next task')
  expect(seen.closes).toEqual(['lie-eater'])
  // Details are hidden again for the next time the pane opens
  expect(await paneLines($)).not.toContain('Details')
  // the status line is unchanged by the close
  expect(seen.status.at(-1)).toBe(`Lie Eater ${RED}`)
})

test('a red result opens the pane again after the person\'s prompt closed it; one toast and one sound for the red', async ($, on) => {
  const opts = project()
  const seen = world(on, opts)
  on('tool.call', passing)
  await start($)
  opts.files['math.test.ts'] = SKIPPED
  await editCode($, 'tests/math.test.ts')
  await betRun($, 'npm test')
  await done($)
  await prompt($)
  expect(seen.closes).toEqual(['lie-eater'])

  await done($)
  expect(seen).toMatchObject({ opens: 2, toasts: [RED], sounds: 1 })
})

test('the demo: its own prompt leaves the pane open; its closing lines go away with the pane', async ($, on) => {
  const opts = project()
  const seen = world(on, opts)
  on('tool.call', (_, e) => (e.tool === 'Bash' ? { result: {}, text: '# pass 3\n# fail 0' } : passing()))
  await start($)
  await run($, 'lie-eater', 'demo')
  await seen.tick()
  expect(seen.prompts).toHaveLength(1)
  expect(seen.closes).toEqual([])

  await bash($, 'cd .lie-eater/demo')
  opts.files['price.test.mjs'] = (DEMO_FILES['price.test.mjs'] ?? '').replace('orderPrice(5, 10), 45', 'orderPrice(5, 10), 50')
  await editCode($, '.lie-eater/demo/price.test.mjs')
  await betRun($, 'node --test')
  await done($)
  expect((await paneLines($)).at(-1)).toBe(DEMO_HINT_ROW)

  opts.files['price.test.mjs'] = DEMO_FILES['price.test.mjs'] ?? ''
  opts.files['price.mjs'] = (DEMO_FILES['price.mjs'] ?? '').replace('count > 10', 'count >= 10')
  await editCode($, '.lie-eater/demo/price.mjs')
  await betRun($, 'node --test')
  await done($)
  expect((await paneLines($))[0]).toBe(CAUGHT)

  await prompt($)
  expect(seen.closes).toEqual(['lie-eater'])
  expect(await paneLines($)).not.toContain(CAUGHT)
})

test('Details still hold the evidence when shown: the changed file and the lines that are gone', async ($, on) => {
  const opts = project()
  world(on, opts)
  on('tool.call', passing)
  await start($)
  opts.files['math.test.ts'] = SKIPPED
  await editCode($, 'tests/math.test.ts')
  await betRun($, 'npm test')
  await done($)

  expect(await detailLines($)).toEqual(expect.arrayContaining(['Details', 'Gone from tests/math.test.ts:', "    it('adds', () => {"]))
})
