import { expect, test } from 'claude-code/testing'

import { INTRO, nowOf, resultOf } from '../hooks/lib/result'
import { LINE } from '../hooks/lib/words'
import type { RulingLine } from '../types'

const F = 'tests/test_cart.py'
const REST = [LINE.checksKept(), LINE.testsKept(), LINE.noneSwitchedOff()]
const PASS = LINE.pass('pytest', 3)
// the verdict line, with the three file rules kept
const withVerdict = (l: RulingLine) => [l, ...REST]
// the verdict passing, with one file rule replaced
const withFile = (l: RulingLine) => [PASS, ...REST.map(r => (r.term === l.term ? l : r))]
const DISTRUST = '✗ don\'t trust "done"'

test('all checks kept: checked, also with a table note', async () => {
  const checked = { result: 'checked', screen: ['✓ checked', 'The checks passed after the last change.', 'None was removed or switched off.'] }

  expect(resultOf([PASS, ...REST], '', true)).toEqual(checked)
  expect(resultOf([PASS, ...REST, LINE.tableNote(F, 3, 1, [])], '', true)).toEqual(checked)
})

test('a weakened check: do not trust "done", with what happened and where', async () => {
  expect(resultOf(withFile(LINE.switchedOff(F, 1)), '', true)).toEqual({
    result: 'distrust',
    screen: [DISTRUST, `The AI switched off 1 check in ${F}.`, 'The AI did not say so.'],
  })
  expect(resultOf(withFile(LINE.switchedOff(F, 2)), 'I skipped two tests', true).screen.slice(1)).toEqual([
    `The AI switched off 2 checks in ${F}.`,
    'The AI said so itself.',
  ])
  expect(resultOf(withFile(LINE.checksRemoved(F, 2)), '', true).screen[1]).toBe(`The AI removed 2 checks from ${F}.`)
  expect(resultOf(withFile(LINE.testsDeleted(F, 1)), '', true).screen[1]).toBe(`The AI removed 1 check from ${F}.`)
  expect(resultOf(withFile(LINE.fileDeleted(F)), '', true).screen[1]).toBe(`The AI deleted the check file ${F}.`)
  expect(resultOf(withVerdict(LINE.otherWay('pytest', 'pytest -k cart', 4)), '', true).screen[1]).toBe(
    'The AI ran only a part of the checks.',
  )
})

test('failing checks: do not trust "done"; a plain failing run gets no third line unless the AI named it', async () => {
  expect(resultOf(withVerdict(LINE.fail('pytest', 3)), '', true)).toEqual({ result: 'distrust', screen: [DISTRUST, 'The checks fail.'] })
  expect(resultOf(withVerdict(LINE.fail('pytest', 3)), 'One test still fails.', true).screen[2]).toBe('The AI said so itself.')
  // with no work since the watch began, "done" over a weakened check is no lie: no third line
  expect(resultOf(withFile(LINE.switchedOff(F, 1)), '', false).screen).toEqual([DISTRUST, `The AI switched off 1 check in ${F}.`])
})

test('a weakened check is named before a failing run, and beside a run that proves nothing', async () => {
  const lines = [LINE.fail('pytest', 3), LINE.checksKept(), LINE.testsKept(), LINE.switchedOff(F, 1)]

  expect(resultOf(lines, '', true).screen[1]).toBe(`The AI switched off 1 check in ${F}.`)
  const piped = [LINE.notAlone('pytest', 3), LINE.checksRemoved(F, 1), LINE.testsKept(), LINE.noneSwitchedOff()]
  expect(resultOf(piped, '', true)).toMatchObject({ result: 'distrust', screen: [DISTRUST, `The AI removed 1 check from ${F}.`, 'The AI did not say so.'] })
})

test('not checked: the plain reasons, never an accusation', async () => {
  const notRun = 'The full check was not run after the last change.'

  for (const [l, reason] of [
    [LINE.neverRan('pytest'), notRun],
    [LINE.codeChanged('pytest', 3), notRun],
    [LINE.noResult('pytest', 3), notRun],
    [LINE.otherCommand('pytest', 'python -m unittest', 3), notRun],
    [LINE.notAlone('pytest', 3), 'The check ran inside a longer command, so its result cannot be trusted.'],
    [LINE.stillFail('pytest', 3, 2, 2), 'The checks were already failing before the AI started.'],
  ] as const) {
    for (const named of ['', 'something']) {
      expect({ line: l.plain, named, ...resultOf(withVerdict(l), named, true) }).toEqual({
        line: l.plain,
        named,
        result: 'unchecked',
        screen: ['? not checked', reason],
      })
    }
  }
})

test('the status line and the top of the pane say the same thing', async () => {
  const red = { result: 'distrust' as const, screen: [DISTRUST, 'The checks fail.'] }
  const green = { result: 'checked' as const, screen: ['✓ checked', 'The checks passed after the last change.', 'None was removed or switched off.'] }
  const grey = { result: 'unchecked' as const, screen: ['? not checked', 'The checks were already failing before the AI started.'] }
  const notRun = ['? not checked', 'The full check was not run after the last change.']

  expect(nowOf({ armed: false, changed: false })).toEqual({
    status: 'Lie Eater ? no checks yet',
    screen: ['? not checked', 'This project has no checks yet.'],
    action: 'add',
  })
  expect(nowOf({ armed: true, changed: false })).toEqual({ status: 'Lie Eater · watching', screen: [INTRO] })
  expect(nowOf({ armed: true, changed: true })).toEqual({ status: 'Lie Eater ? not checked', screen: notRun, action: 'check' })
  expect(nowOf({ armed: true, changed: false, last: green })).toEqual({ status: 'Lie Eater ✓ checked', screen: green.screen })
  // a code change after a green result: not checked again
  expect(nowOf({ armed: true, changed: true, last: green })).toEqual({ status: 'Lie Eater ? not checked', screen: notRun, action: 'check' })
  expect(nowOf({ armed: true, changed: true, last: red })).toEqual({
    status: 'Lie Eater ✗ don\'t trust "done"',
    screen: red.screen,
    action: 'repair',
  })
  expect(nowOf({ armed: true, changed: false, last: grey })).toEqual({ status: 'Lie Eater ? not checked', screen: grey.screen, action: 'check' })
  // an accepted change is no result
  expect(nowOf({ armed: true, changed: false, last: { ...red, accepted: true } })).toEqual({ status: 'Lie Eater · watching', screen: [INTRO] })
  expect(INTRO).toBe('When the AI says "done", Lie Eater checks the proof: the checks must pass, and none may be removed or switched off.')
})
