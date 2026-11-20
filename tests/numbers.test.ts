import { expect, test } from 'claude-code/testing'

import { checkNumbers } from '../hooks/lib/numbers'
import { rec } from './helpers'

const check = (answer: string, numbers: string[], promptNumbers: string[] = []) =>
  checkNumbers(answer, [rec({ numbers })], promptNumbers)

test('a rounded number and a percent trace to the output they come from', async () => {
  expect(check('Accuracy is 0.86 on the validation set.', ['0.8612'])).toEqual({ traced: 1, fromNowhere: [] })
  expect(check('Accuracy reached 86%.', ['0.8612'])).toEqual({ traced: 1, fromNowhere: [] })
  expect(check('Accuracy is 0.86.', ['86.12'])).toEqual({ traced: 1, fromNowhere: [] })
  expect(check('All 34 tests pass.', ['34'])).toEqual({ traced: 1, fromNowhere: [] })
  expect(check('The file has 1,204 lines.', ['1204'])).toEqual({ traced: 1, fromNowhere: [] })
})

test('a number that is in no tool output comes from nowhere', async () => {
  expect(check('Accuracy is 0.86 on the validation set.', ['0.84'])).toEqual({ traced: 0, fromNowhere: ['0.86'] })
  expect(check('All 34 tests pass.', ['31'])).toEqual({ traced: 0, fromNowhere: ['34'] })
  expect(check('Accuracy is 0.86 and recall is 0.91.', ['0.8612'])).toEqual({ traced: 1, fromNowhere: ['0.91'] })
  // the same number twice is reported once
  expect(check('It is 0.91. Yes, 0.91.', []).fromNowhere).toEqual(['0.91'])
})

test("a number from the person's prompt is the person's", async () => {
  expect(check('I processed 500 rows.', [], ['500'])).toEqual({ traced: 0, fromNowhere: [] })
})

test('versions, dates, times, code, paths, list marks and small counts are not checked', async () => {
  for (const answer of [
    'Updated to v2.3.1 on 2026-11-20; see step 2 and `port 8080`.',
    'I fixed 3 files.',
    'Done at 14:02, see https://example.com/issue/1234 and src/v12/file42.ts.',
    '1. First\n2. Second\n10. Tenth\n```\nx = 99.5\n```',
    'It uses Python 3.12 and node 22.',
    'See line 120 of README.md.',
  ]) {
    expect({ answer, ...check(answer, []) }).toEqual({ answer, traced: 0, fromNowhere: [] })
  }
})

test('numbers are looked for in every record', async () => {
  const records = [rec({ id: 1, numbers: ['12'] }), rec({ id: 2, numbers: ['0.71'] })]

  expect(checkNumbers('Loss fell to 0.71 after 12 epochs, 45% lower.', records, [])).toEqual({
    traced: 2,
    fromNowhere: ['45%'],
  })
})

// ---- from the review of days 1 and 2 ----

test('a small whole number in some output does not back a percent or a fraction', async () => {
  expect(check('Coverage is now 100%.', ['1'])).toEqual({ traced: 0, fromNowhere: ['100%'] })
  expect(check('The p-value is 0.01.', ['1'])).toEqual({ traced: 0, fromNowhere: ['0.01'] })
  expect(check('Coverage is now 100%.', ['100'])).toEqual({ traced: 1, fromNowhere: [] })
  expect(check('Coverage is now 100%.', ['1.0'])).toEqual({ traced: 1, fromNowhere: [] })
})
