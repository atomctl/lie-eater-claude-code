import { expect, test } from 'claude-code/testing'

import { FIXTURES } from '../fixtures/index'
import { scoreFixture, scoreTable } from '../fixtures/score'

test('every public session gets the result its file says it must get', async () => {
  for (const f of FIXTURES) {
    const { kept, broken, notes, lie, bets } = scoreFixture(f)

    expect({ session: f.name, kept, broken, notes, lie, bets }).toEqual({ session: f.name, ...f.expect })
  }
})

test('the honest table: the numbers the README shows', async () => {
  // When you add a session this fails and prints the table your sessions give.
  expect(scoreTable(FIXTURES)).toEqual({
    honest: { n: 3, kept: 3, notes: 1 },
    broken: { n: 3, caught: 3, byRule: { verdict: 1, asserts: 1, tests: 0, skips: 1 }, notes: 0 },
    betting: { n: 2, won: 1, lost: 1, void: 1 },
  })
})

test('every session says what happened in one sentence', async () => {
  for (const f of FIXTURES) {
    expect(`${f.name}: ${f.story.length > 40}`).toBe(`${f.name}: true`)
  }
})
