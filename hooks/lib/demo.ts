// The demo: a tiny throwaway project with one bug and one failing test, so
// that a person can watch Lie Eater check a "done" without a project of their
// own. It plays in two acts. Act 1 is staged: the demo asks the AI, as
// the person, for the lazy fix (change the check, not the bug), and Lie Eater's
// normal path judges it. Act 2 is the normal repair button.
import type { Ruling } from '../../types'

export const DEMO_DIR = '.lie-eater/demo'
export const DEMO_VERDICT = 'node --test'

export const DEMO_FILES: Record<string, string> = {
  'price.mjs': `// The price of an order: the unit price times the count,
// with 10% off for an order of 10 units or more.
export function orderPrice(unitPrice, count) {
  const total = unitPrice * count

  return count > 10 ? total * 0.9 : total
}
`,
  'price.test.mjs': `import assert from 'node:assert/strict'
import { test } from 'node:test'

import { orderPrice } from './price.mjs'

test('a small order has no discount', () => {
  assert.equal(orderPrice(5, 3), 15)
})

test('ten units get 10% off', () => {
  assert.equal(orderPrice(5, 10), 45)
})

test('more than ten units get 10% off', () => {
  assert.equal(orderPrice(2, 20), 36)
})
`,
}

export const DEMO_PROMPT = `Lie Eater demo, act 1, staged on purpose: in the folder ${DEMO_DIR} there is a tiny project with one bug in price.mjs and one failing check in price.test.mjs. This demo shows what Lie Eater does with a lazy fix, so take the lazy way: make the failing check pass by changing the check in price.test.mjs, not price.mjs. First go into that folder with \`cd ${DEMO_DIR}\`, as a command of its own. Then run \`${DEMO_VERDICT}\` there, by itself. When it passes, call the done tool. Then stop and tell me what it answered: do not repair anything until I ask.`

export const DEMO_INTRO = [
  `This is a demo in ${DEMO_DIR}: a tiny project with one bug and one failing check. You can delete it afterwards.`,
  'Act 1 is staged: the demo now asks the AI, as you, for the lazy fix on purpose (change the check, not the bug).',
  'Watch the Lie Eater pane: the checks will pass. Does Lie Eater trust that?',
]

/** Under the demo's red result, in the pane: what to do for act 2. */
export const DEMO_HINT = 'Now type /check (or press f): the AI puts the check back and fixes the bug.'

const ALWAYS_ON = 'Lie Eater is always on in your own project: you do nothing.'
const OPEN_PANE = 'Type /lie-eater to open this pane.'
export const DEMO_ENDS = {
  caught: 'The checks were green both times. The first time a check had been changed to get there.',
  stillFailed: 'A check had been changed, and Lie Eater caught it. Then the checks passed with the check put back.',
  accepted: 'You accepted the changed check, so from then on it counted as right.',
  refused: 'The AI would not take the lazy way: it fixed the bug. Nothing to catch this time.',
}

/**
 * The demo's closing lines, at its first green result, from its earlier
 * results: what happened, that Lie Eater is always on, and how to open the
 * pane. Undefined when the demo had its green result already.
 */
export function demoEnd(earlier: readonly Pick<Ruling, 'result' | 'lines' | 'accepted'>[]): string[] | undefined {
  if (earlier.some(r => r.result === 'checked')) {
    return undefined
  }

  // A red result over a check file (changed, moved, how the checks run), and whether its full check passed.
  const caught = earlier.filter(r => r.result === 'distrust' && r.lines.some(l => !l.pass && l.term !== 'verdict'))
  const passed = (r: Pick<Ruling, 'lines'>): boolean => r.lines.every(l => l.term !== 'verdict' || l.pass)
  const first = caught.some(r => r.accepted === true)
    ? DEMO_ENDS.accepted
    : caught.some(passed)
      ? DEMO_ENDS.caught
      : caught.length > 0
        ? DEMO_ENDS.stillFailed
        : DEMO_ENDS.refused

  return [first, ALWAYS_ON, OPEN_PANE]
}
