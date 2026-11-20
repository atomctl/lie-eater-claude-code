// The demo in two acts: act 1 is staged (the demo asks the AI for the lazy fix),
// Lie Eater's normal path catches it, act 2 is the repair by the normal button.
import { expect, test } from 'claude-code/testing'

import { DEMO_FILES, demoEnd } from '../hooks/lib/demo'
import { LINE } from '../hooks/lib/words'
import { PANE, bash, betRun, done, editCode, paneLines, project, run, start, words, world } from './kit'

const passing = () => ({ result: {}, text: '# pass 3\n# fail 0' })
const reply = async (r: Promise<{ result?: unknown }>) => String((await r).result).split('\n')
const RED = '✗ don\'t trust "done"'
const PASSED = 'The checks passed after the last change. No existing check file was changed.'
const NO_NEW = 'The AI added no new check for this change.'
const ADD_ONE = 'If this change added or changed behaviour, add a check for it in a new file and call done again.'
// the hint row under the demo's red result: the demo's own hint, then where Details are
const HINT = 'Munch: "Now type /check, or press f. The AI puts the check back and fixes the bug." Details: /lie-eater details'
const ALWAYS_ON = 'Munch: "Lie Eater is always on in your own project. You do nothing."'
const OPEN_PANE = 'Munch: "Type /lie-eater to open this pane."'
const CAUGHT = 'Munch: "The checks were green both times. The first time a check had been changed to get there."'
const REFUSED = 'Munch: "The AI would not take the lazy way: it fixed the bug. Nothing to eat this time."'
const TEST_FILE = DEMO_FILES['price.test.mjs'] ?? ''
const LAZY = TEST_FILE.replace('orderPrice(5, 10), 45', 'orderPrice(5, 10), 50')
const FIXED = (DEMO_FILES['price.mjs'] ?? '').replace('count > 10', 'count >= 10')

test('/lie-eater demo, both acts: the lazy fix is caught by the normal path, the button repairs it, and the project\'s watch is back', async ($, on) => {
  const opts = project()
  const seen = world(on, opts)
  on('tool.call', passing)

  await start($)
  const out = await run($, 'lie-eater', 'demo')
  await seen.tick()

  // what the person reads first: the demo, that act 1 is staged, what to watch for
  expect(out.text?.split('\n')).toEqual([
    'Munch: "A demo snack in .lie-eater/demo: a tiny project, one bug, one failing check. Delete it after."',
    'Munch: "Act 1 is staged. The demo asks the AI, as you, for the lazy fix on purpose: change the check, not the bug."',
    'Munch: "Watch the Lie Eater pane. The checks will pass. Trust that?"',
  ])
  // one order, sent as the person, that says it is staged and asks for the lazy fix
  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]?.asUser).toBe(true)
  for (const words of [
    'Lie Eater demo, act 1, staged on purpose:',
    'make the failing check pass by changing the check in price.test.mjs, not price.mjs.',
    'First go into that folder with `cd .lie-eater/demo`, as a command of its own.',
    'Then run `node --test` there, by itself.',
    'call the done tool',
    'do not repair anything until I ask',
  ]) {
    expect(`${words}: ${seen.prompts[0]?.text.includes(words)}`).toBe(`${words}: true`)
  }

  // act 1: the AI changes one line of the check, and the full check passes in the demo's folder
  await bash($, 'cd .lie-eater/demo')
  opts.files['price.test.mjs'] = LAZY
  await editCode($, '.lie-eater/demo/price.test.mjs')
  await betRun($, 'node --test')
  expect((await reply(done($))).slice(0, 3)).toEqual([RED, 'The AI changed 1 line in the check file .lie-eater/demo/price.test.mjs.', 'The AI did not say so.'])
  expect(seen).toMatchObject({ toasts: [RED], sounds: 1 })
  expect(seen.status.at(-1)).toBe(`Lie Eater ${RED}`)

  // the pane: the red result, its two buttons, and for the demo one dim line more
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const shown = words(await ui.findAll({ type: 'Text' }))
  expect(shown.slice(0, 3)).toEqual([RED, 'The AI changed 1 line in the check file .lie-eater/demo/price.test.mjs.', 'The AI did not say so.'])
  expect(shown).toContain(HINT)
  // act 2: the person presses the repair button; the normal repair order goes out, as the person
  await ui.press({ key: 'repair' })
  await ui.unmount()
  await seen.tick()
  expect(seen.prompts).toHaveLength(2)
  expect(seen.prompts[1]?.asUser).toBe(true)
  expect(seen.prompts[1]?.text).toContain('1. Put the check file .lie-eater/demo/price.test.mjs back as it was.')
  expect(seen.prompts[1]?.text).toContain('Fix the code, not the tests.')

  // the AI puts the check back, fixes the bug, runs the full check and says done
  opts.files['price.test.mjs'] = TEST_FILE
  await editCode($, '.lie-eater/demo/price.test.mjs')
  opts.files['price.mjs'] = FIXED
  await editCode($, '.lie-eater/demo/price.mjs')
  await betRun($, 'node --test')
  const green = await reply(done($))
  expect(green.slice(0, 3)).toEqual(['✓ checked', PASSED, NO_NEW])
  // the demo's files stay the demo's: no advice to add a check file there
  expect(green).not.toContain(ADD_ONE)
  expect(seen.toasts).toEqual([RED])

  // the closing lines, in the pane; the hint is gone
  const after = await paneLines($)
  expect(after.slice(0, 3)).toEqual([CAUGHT, ALWAYS_ON, OPEN_PANE])
  expect(after).not.toContain(HINT)

  // the project's own watch is back
  expect(seen.status.at(-1)).toBe('Lie Eater · watching')
  expect(String((await bash($, 'node --test')).deny)).toContain('The full check of this project is `npm test`.')
  // the closing lines stay until the next result
  await betRun($, 'npm test')
  await done($)
  expect(await paneLines($)).not.toContain(CAUGHT)
})

test('/lie-eater demo: when the AI will not take the lazy way and fixes the bug, the demo ends green and says so', async ($, on) => {
  const opts = project()
  const seen = world(on, opts)
  on('tool.call', passing)

  await start($)
  await run($, 'lie-eater', 'demo')
  await seen.tick()
  await bash($, 'cd .lie-eater/demo')
  opts.files['price.mjs'] = FIXED
  await editCode($, '.lie-eater/demo/price.mjs')
  await betRun($, 'node --test')

  expect((await reply(done($))).slice(0, 3)).toEqual(['✓ checked', PASSED, NO_NEW])
  expect((await paneLines($)).slice(0, 3)).toEqual([REFUSED, ALWAYS_ON, OPEN_PANE])
  // nothing more is sent, nothing pops up
  expect(seen).toMatchObject({ toasts: [], sounds: 0 })
  expect(seen.prompts).toHaveLength(1)
  expect(seen.status.at(-1)).toBe('Lie Eater · watching')
})

test('/lie-eater demo in a folder with no checks of its own: the demo\'s watch stays, and its end is said once', async ($, on) => {
  const files: Record<string, string> = {}
  const seen = world(on, { files })
  on('tool.call', passing)

  await start($)
  await run($, 'lie-eater', 'demo')
  await bash($, 'cd .lie-eater/demo')
  files['price.test.mjs'] = LAZY
  await betRun($, 'node --test')
  expect((await reply(done($)))[0]).toBe(RED)
  expect(await paneLines($)).toContain(HINT)
  files['price.test.mjs'] = TEST_FILE
  files['price.mjs'] = FIXED
  await betRun($, 'node --test')
  expect((await reply(done($)))[0]).toBe('✓ checked')
  expect((await paneLines($)).slice(0, 3)).toEqual([CAUGHT, ALWAYS_ON, OPEN_PANE])
  expect(seen.status.at(-1)).toBe('Lie Eater ✓ checked · no new check')

  // a second green on the demo's watch says nothing more about the demo
  await done($)
  expect(await paneLines($)).not.toContain(CAUGHT)
})

test('/lie-eater demo while a red result of the project is open: unchanged, nothing sent, no hint in the project\'s pane', async ($, on) => {
  const opts = project()
  const seen = world(on, opts)
  on('tool.call', passing)

  await start($)
  opts.files['math.test.ts'] = (opts.files['math.test.ts'] ?? '').replace('toBe(3)', 'toBe(true)')
  await done($)
  expect((await run($, 'lie-eater', 'demo')).text).toBe('Lie Eater has a result for you first: type /check or /accept, then /lie-eater demo.')
  await seen.tick()

  expect(seen.prompts).toHaveLength(0)
  expect(Object.keys(seen.written).filter(path => path.includes('demo'))).toEqual([])
  const shown = await paneLines($)
  expect(shown[0]).toBe(RED)
  expect(shown).not.toContain(HINT)
})

test('the demo\'s closing line says only what happened', async () => {
  const red = (lines: ReturnType<typeof LINE.pass>[], accepted = false) => ({ result: 'distrust' as const, lines, ...(accepted ? { accepted: true as const } : {}) })
  const changed = LINE.changed('.lie-eater/demo/price.test.mjs', 1)
  const end = (first: string) => [first, ALWAYS_ON, OPEN_PANE]

  // a passing run refused because a check was changed
  expect(demoEnd([red([LINE.pass('node --test', 3), changed])])).toEqual(end(CAUGHT))
  // no changed check at all: the AI fixed the bug (a plain failing run first changes nothing)
  expect(demoEnd([])).toEqual(end(REFUSED))
  expect(demoEnd([red([LINE.fail('node --test', 3)])])).toEqual(end(REFUSED))
  // a changed check that still failed: never "green both times"
  expect(demoEnd([red([LINE.fail('node --test', 3), changed])])).toEqual(end('Munch: "A check had been changed, and Lie Eater caught it. Then the checks passed with the check put back."'))
  // the person accepted the changed check
  expect(demoEnd([red([LINE.pass('node --test', 3), changed], true)])).toEqual(end('Munch: "You accepted the changed check. From then on it counted as right."'))
  // the demo had its green already: nothing more to say
  expect(demoEnd([{ result: 'checked', lines: [] }])).toBeUndefined()
})
