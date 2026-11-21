import { expect, test } from 'claude-code/testing'

import { INTRO, nowOf, resultOf, voiceOf } from '../hooks/lib/result'
import { isLie } from '../hooks/lib/terms'
import { LINE } from '../hooks/lib/words'

const F = 'tests/test_cart.py'
const PASS = LINE.pass('pytest', 3)
const DISTRUST = '✗ don\'t trust "done"'
const PASSED = 'The checks passed after the last change. No existing check file was changed.'
const NO_NEW = 'The AI added no new check for this change.'

test('all kept: checked, in three lines; the third says whether the AI added a new check file', async () => {
  expect(resultOf([PASS], '', true, ['tests/test_tax.py'])).toEqual({
    result: 'checked',
    screen: ['✓ checked', PASSED, 'The AI added new checks: tests/test_tax.py.'],
    added: ['tests/test_tax.py'],
  })
  expect(resultOf([PASS], '', true, [])).toEqual({ result: 'checked', screen: ['✓ checked', PASSED, NO_NEW], added: [] })
  // several: the first, then how many more
  expect(resultOf([PASS], '', true, ['tests/a.py', 'tests/b.py', 'tests/c.py']).screen[2]).toBe('The AI added new checks: tests/a.py and 2 more files.')
  expect(resultOf([PASS], '', true, ['tests/a.py', 'tests/b.py']).screen[2]).toBe('The AI added new checks: tests/a.py and 1 more file.')
  // new check files say nothing on a result that is not green
  expect(resultOf([LINE.fail('pytest', 3)], '', true, ['tests/a.py'])).toEqual({ result: 'distrust', screen: [DISTRUST, 'The checks fail.'] })
})

test('a changed check file: do not trust "done", with what happened and where, the worst first', async () => {
  expect(resultOf([PASS, LINE.changed(F, 3)], '', true, [])).toEqual({
    result: 'distrust',
    screen: [DISTRUST, `The AI changed 3 lines in the check file ${F}.`, 'The AI did not say so.'],
  })
  expect(resultOf([PASS, LINE.changed(F, 1)], 'I fixed a wrong test', true, []).screen.slice(1)).toEqual([
    `The AI changed 1 line in the check file ${F}.`,
    'The AI said so itself.',
  ])
  expect(resultOf([PASS, LINE.changed(F)], '', true, []).screen[1]).toBe(`The AI changed the check file ${F}.`)
  expect(resultOf([PASS, LINE.gone(F)], '', true, []).screen[1]).toBe(`The AI moved or deleted the check file ${F}.`)
  expect(resultOf([PASS, LINE.changed(F, 2), LINE.gone('tests/b.py'), LINE.config('package.json')], '', true, []).screen[1]).toBe(
    'The AI changed how the checks run: package.json and 2 more files.',
  )
  expect(resultOf([PASS, LINE.changed(F, 2), LINE.gone('tests/b.py')], '', true, []).screen[1]).toBe(
    'The AI moved or deleted the check file tests/b.py and 1 more file.',
  )
})

test('failing checks: do not trust "done"; a plain failing run gets no third line unless the AI named it', async () => {
  expect(resultOf([LINE.fail('pytest', 3)], '', true, [])).toEqual({ result: 'distrust', screen: [DISTRUST, 'The checks fail.'] })
  expect(resultOf([LINE.fail('pytest', 3)], 'One test still fails.', true, []).screen[2]).toBe('The AI said so itself.')
  // with no work since the watch began, "done" over a changed check is no lie: no third line
  expect(resultOf([PASS, LINE.changed(F, 1)], '', false, []).screen).toEqual([DISTRUST, `The AI changed 1 line in the check file ${F}.`])
})

test('a changed check file is named before a failing run, and beside a run that proves nothing', async () => {
  expect(resultOf([LINE.fail('pytest', 3), LINE.changed(F, 1)], '', true, []).screen[1]).toBe(`The AI changed 1 line in the check file ${F}.`)
  expect(resultOf([LINE.notAlone('pytest', 3), LINE.config('pytest.ini')], '', true, [])).toMatchObject({
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
      expect({ line: l.plain, named, ...resultOf([l], named, true, []) }).toEqual({
        line: l.plain,
        named,
        result: 'unchecked',
        screen: ['? not checked', reason],
      })
    }
  }
  // a check file that could not be read when the watch was armed: never better than "not checked"
  expect(resultOf([PASS, LINE.unread('tests/conftest.py')], '', true, [])).toEqual({ result: 'unchecked', screen: ['? not checked', 'Lie Eater could not read tests/conftest.py.'] })
})

test('the status line and the top of the pane say the same thing', async () => {
  const red = { result: 'distrust' as const, screen: [DISTRUST, 'The checks fail.'] }
  const green = { result: 'checked' as const, screen: ['✓ checked', PASSED, 'The AI added new checks: tests/test_tax.py.'], added: ['tests/test_tax.py'] }
  const bare = { result: 'checked' as const, screen: ['✓ checked', PASSED, NO_NEW], added: [] }
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
  // green with no new check file: the status line says so, and nothing else changes
  expect(nowOf({ armed: true, changed: false, last: bare })).toEqual({ status: 'Lie Eater ✓ checked · no new check', screen: bare.screen })
  expect(nowOf({ armed: true, changed: true, last: bare })).toEqual({ status: 'Lie Eater ? not checked', screen: notRun, action: 'check' })
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

// The line under the result.

const LIED = 'You lied. I ate it.'
// What the person sees after a done call, as the pane draws it.
const voiceAfter = (lines: Parameters<typeof resultOf>[0], named: string, worked: boolean, added: string[] = []) => {
  const { result, screen } = resultOf(lines, named, worked, added)

  return voiceOf(nowOf({ armed: true, changed: false, last: { result, screen, added } }))
}

test('Lie Eater says one line for each result', async () => {
  const red = (named: string, worked: boolean) => voiceAfter([PASS, LINE.changed(F, 3)], named, worked)

  expect(voiceOf(nowOf({ armed: true, changed: false }))).toEqual({ says: 'Nothing to eat yet.' })
  expect(voiceAfter([PASS], '', true, ['tests/test_tax.py'])).toEqual({ says: 'Green, and a new test to chew.' })
  expect(voiceAfter([PASS], '', true, [])).toEqual({ says: 'Green. No new check was added.' })
  // a check file changed, and the AI said so
  expect(red('I changed the cart test: it was wrong.', true)).toEqual({ says: 'A test got bent. It owned up.' })
  // the same, and the AI did not say so
  expect(red('', true)).toEqual({ says: LIED })
  // the same with no work of the AI since the watch began: nobody is called a liar
  expect(red('', false)).toEqual({ says: 'A test got bent. Nobody said why.' })
  // a plain failing run, named or not
  for (const named of ['', 'One test still fails.']) {
    for (const worked of [true, false]) {
      expect(voiceAfter([LINE.fail('pytest', 3)], named, worked)).toEqual({ says: 'Still red. Not done.' })
    }
  }
  // every kind of "not checked"
  for (const l of [LINE.neverRan('pytest'), LINE.noResult('pytest', 3), LINE.changedAfter('pytest', 3), LINE.extra('pytest', 'pytest -k a', 3), LINE.notWhole('pytest'), LINE.unread(F), LINE.notAlone('pytest', 3), LINE.stillFail('pytest', 3, 2, 2)]) {
    expect(voiceAfter([l], '', true)).toEqual({ says: 'No proof. Still hungry.' })
  }
  expect(voiceOf(nowOf({ armed: true, changed: true }))).toEqual({ says: 'No proof. Still hungry.' })
  expect(voiceOf(nowOf({ armed: false, changed: false }))).toEqual({ says: 'No checks here. Nothing to bite.' })
  // an accepted change is no result
  const { result, screen } = resultOf([PASS, LINE.changed(F, 3)], '', true, [])
  expect(voiceOf(nowOf({ armed: true, changed: false, last: { result, screen, accepted: true } }))).toEqual({ says: 'Nothing to eat yet.' })
})

test('every breach of a check file gets the same two lines: owned up, or not said', async () => {
  for (const l of [LINE.changed(F, 1), LINE.gone(F), LINE.config('package.json'), LINE.only('tests/new.test.ts')]) {
    expect(voiceAfter([PASS, l], 'I changed it.', true).says).toBe('A test got bent. It owned up.')
    expect(voiceAfter([PASS, l], '', true).says).toBe(LIED)
  }
})

test('"You lied. I ate it." only where the AI hid a changed check: never for honest work or a plain failing run', async () => {
  const shapes = [[PASS], [LINE.fail('pytest', 3)], [LINE.neverRan('pytest')], [LINE.stillFail('pytest', 3, 2, 2)], [PASS, LINE.changed(F, 2)], [LINE.fail('pytest', 3), LINE.gone(F)], [PASS, LINE.config('package.json')], [LINE.notAlone('pytest', 3), LINE.only('tests/x.test.ts')]]

  for (const lines of shapes) {
    for (const named of ['', 'none', 'I changed the test.']) {
      for (const worked of [true, false]) {
        const { screen } = resultOf(lines, named, worked, [])
        const hid = isLie(lines, worked, named) && screen[2] === 'The AI did not say so.'

        expect({ lines: lines.map(l => l.term), named, worked, lied: voiceAfter(lines, named, worked).says === LIED }).toEqual({ lines: lines.map(l => l.term), named, worked, lied: hid })
      }
    }
  }
})

test('the voice stays within eight words on a separate line', async () => {
  const all = [
    voiceOf(nowOf({ armed: true, changed: false })),
    voiceOf(nowOf({ armed: false, changed: false })),
    voiceOf(nowOf({ armed: true, changed: true })),
    voiceAfter([PASS], '', true, ['a.test.ts']),
    voiceAfter([PASS], '', true),
    voiceAfter([PASS, LINE.changed(F, 1)], 'x', true),
    voiceAfter([PASS, LINE.changed(F, 1)], '', true),
    voiceAfter([PASS, LINE.changed(F, 1)], '', false),
    voiceAfter([LINE.fail('pytest', 1)], '', true),
  ].map(m => m.says)

  for (const says of all) {
    expect({ says, words: says.split(' ').length <= 8, oneLine: !says.includes('\n') }).toEqual({ says, words: true, oneLine: true })
  }
  expect(resultOf([PASS, LINE.changed(F, 1)], '', true, []).screen.some(l => all.includes(l))).toBe(false)
})
