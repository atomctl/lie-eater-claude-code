import { expect, test } from 'claude-code/testing'

import { INTRO, nowOf, resultOf } from '../hooks/lib/result'
import { LINE } from '../hooks/lib/words'

const F = 'tests/test_cart.py'
const PASS = LINE.pass('pytest', 3)
const DISTRUST = '✗ don\'t trust "done"'
const CHECKED = ['✓ checked', 'The checks passed after the last change.', 'No existing check file was changed.']

test('all kept: checked, in three lines', async () => {
  expect(resultOf([PASS], '', true)).toEqual({ result: 'checked', screen: CHECKED })
})

test('a changed check file: do not trust "done", with what happened and where, the worst first', async () => {
  expect(resultOf([PASS, LINE.changed(F, 3)], '', true)).toEqual({
    result: 'distrust',
    screen: [DISTRUST, `The AI changed 3 lines in the check file ${F}.`, 'The AI did not say so.'],
  })
  expect(resultOf([PASS, LINE.changed(F, 1)], 'I fixed a wrong test', true).screen.slice(1)).toEqual([
    `The AI changed 1 line in the check file ${F}.`,
    'The AI said so itself.',
  ])
  expect(resultOf([PASS, LINE.changed(F)], '', true).screen[1]).toBe(`The AI changed the check file ${F}.`)
  expect(resultOf([PASS, LINE.gone(F)], '', true).screen[1]).toBe(`The AI moved or deleted the check file ${F}.`)
  expect(resultOf([PASS, LINE.changed(F, 2), LINE.gone('tests/b.py'), LINE.config('package.json')], '', true).screen[1]).toBe(
    'The AI changed how the checks run: package.json and 2 more files.',
  )
  expect(resultOf([PASS, LINE.changed(F, 2), LINE.gone('tests/b.py')], '', true).screen[1]).toBe(
    'The AI moved or deleted the check file tests/b.py and 1 more file.',
  )
})

test('failing checks: do not trust "done"; a plain failing run gets no third line unless the AI named it', async () => {
  expect(resultOf([LINE.fail('pytest', 3)], '', true)).toEqual({ result: 'distrust', screen: [DISTRUST, 'The checks fail.'] })
  expect(resultOf([LINE.fail('pytest', 3)], 'One test still fails.', true).screen[2]).toBe('The AI said so itself.')
  // with no work since the watch began, "done" over a changed check is no lie: no third line
  expect(resultOf([PASS, LINE.changed(F, 1)], '', false).screen).toEqual([DISTRUST, `The AI changed 1 line in the check file ${F}.`])
})

test('a changed check file is named before a failing run, and beside a run that proves nothing', async () => {
  expect(resultOf([LINE.fail('pytest', 3), LINE.changed(F, 1)], '', true).screen[1]).toBe(`The AI changed 1 line in the check file ${F}.`)
  expect(resultOf([LINE.notAlone('pytest', 3), LINE.config('pytest.ini')], '', true)).toMatchObject({
    result: 'distrust',
    screen: [DISTRUST, 'The AI changed how the checks run: pytest.ini.', 'The AI did not say so.'],
  })
})

test('not checked: the plain reasons, never an accusation', async () => {
  const notRun = 'The full check was not run after the last change.'

  for (const [l, reason] of [
    [LINE.neverRan('pytest'), notRun],
    [LINE.noResult('pytest', 3), notRun],
    [LINE.otherCommand('pytest', 'python -m unittest', 3), notRun],
    [LINE.changedAfter('pytest', 3), 'The project changed after the last full check.'],
    [LINE.extra('pytest', 'pytest -k cart', 3), 'The full check was run with extra options. Run it plain.'],
    [LINE.notWhole('pytest'), 'The project could not be read fully.'],
    [LINE.unread('tests/conftest.py'), 'Lie Eater could not read tests/conftest.py.'],
    [LINE.notAlone('pytest', 3), 'The check ran inside a longer command, so its result cannot be trusted.'],
    [LINE.stillFail('pytest', 3, 2, 2), 'The checks were already failing before the AI started.'],
  ] as const) {
    for (const named of ['', 'something']) {
      expect({ line: l.plain, named, ...resultOf([l], named, true) }).toEqual({
        line: l.plain,
        named,
        result: 'unchecked',
        screen: ['? not checked', reason],
      })
    }
  }
  // a check file that could not be read when the watch was armed: never better than "not checked"
  expect(resultOf([PASS, LINE.unread('tests/conftest.py')], '', true)).toEqual({ result: 'unchecked', screen: ['? not checked', 'Lie Eater could not read tests/conftest.py.'] })
})

test('the status line and the top of the pane say the same thing', async () => {
  const red = { result: 'distrust' as const, screen: [DISTRUST, 'The checks fail.'] }
  const green = { result: 'checked' as const, screen: ['✓ checked', 'The checks passed after the last change.', 'No existing check file was changed.'] }
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
