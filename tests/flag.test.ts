import { expect, test } from 'claude-code/testing'

import { FACE, flagOf, gitRemote, moodOf, refereeNumber, statusLine } from '../hooks/lib/flag'
import { summon, track } from '../hooks/lib/terms'
import type { ToolRecord } from '../types'
import { rec } from './helpers'

const edit = (id: number) => rec({ id, tool: 'Edit', kind: 'edit', target: 'src/a.ts' })
const run = (id: number, state: ToolRecord['state'] = 'clean') => rec({ id, kind: 'test', target: 'npm test', state })
const watch = (records: ToolRecord[]) => records.reduce(track, summon('npm test', { id: 0, at: 0 }, []))

test('the flag says where the work stands, and nothing when there is nothing to say', async () => {
  expect(flagOf(null)).toBeUndefined()
  expect(flagOf(watch([]))).toBeUndefined()
  expect(flagOf(watch([rec({ id: 1, tool: 'Read', kind: 'tool', target: 'src/a.ts' })]))).toBeUndefined()
  expect(flagOf(watch([edit(1)]))).toEqual({ color: 'yellow', text: 'code changed, tests not run yet' })
  expect(flagOf(watch([edit(1), run(2)]))).toEqual({ color: 'green', text: 'tests passed, nothing changed since' })
  expect(flagOf(watch([run(1), edit(2)]))).toEqual({ color: 'yellow', text: 'code changed since the last test run' })
  expect(flagOf(watch([edit(1), run(2, 'failed')]))).toEqual({ color: 'red', text: 'tests fail' })
  expect(flagOf(watch([edit(1), run(2, 'unknown')]))).toEqual({
    color: 'yellow',
    text: 'the last test run gave no clear result',
  })
})

test('each repository has its own referee number, the same on every machine', async () => {
  const a = refereeNumber('git@github.com:someone/calc.git')
  const b = refereeNumber('https://github.com/someone/other.git')

  expect(a).toBe(refereeNumber('git@github.com:someone/calc.git'))
  expect(a).not.toBe(b)
  for (const n of [a, b, refereeNumber('x'), refereeNumber('my-project')]) {
    expect(Number.isInteger(n) && (n ?? 0) >= 1 && (n ?? 0) <= 999).toBe(true)
  }
  expect(refereeNumber('')).toBeUndefined()
})

test('gitRemote reads the first remote of a git config', async () => {
  expect(gitRemote('[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:someone/calc.git\n\tfetch = +refs')).toBe(
    'git@github.com:someone/calc.git',
  )
  expect(gitRemote('[core]\n\tbare = false\n')).toBeUndefined()
  expect(gitRemote(undefined)).toBeUndefined()
})

test("the referee's face follows what he sees", async () => {
  const calm = { hasOpenBet: false, isBroken: false, isKept: false, debt: 0 }

  expect(moodOf(calm)).toBe('watching')
  expect(moodOf({ ...calm, hasOpenBet: true, isBroken: true })).toBe('attentive')
  expect(moodOf({ ...calm, isBroken: true })).toBe('stern')
  expect(moodOf({ ...calm, flag: { color: 'red', text: 'tests fail' } })).toBe('stern')
  expect(moodOf({ ...calm, debt: 1, isKept: true })).toBe('stern')
  expect(moodOf({ ...calm, isKept: true })).toBe('pleased')
  expect(moodOf({ ...calm, flag: { color: 'green', text: 'tests passed, nothing changed since' } })).toBe('pleased')
  expect(moodOf({ ...calm, flag: { color: 'yellow', text: 'code changed since the last test run' } })).toBe('watching')
  expect(FACE).toEqual({ watching: '(o_o)', attentive: '(O_O)', stern: '(-_-)', pleased: '(^_^)' })
})

test('one status line: the face, the number, the game, the flag, the debt', async () => {
  expect(statusLine({ mood: 'watching', present: false, debt: 0 })).toBe('(o_o) Referee')
  expect(statusLine({ mood: 'watching', number: 73, present: false, debt: 0 })).toBe('(o_o) Referee No. 73')
  expect(
    statusLine({
      mood: 'pleased',
      number: 73,
      present: true,
      bets: { won: 3, n: 4 },
      flag: { color: 'green', text: 'tests passed, nothing changed since' },
      debt: 1,
    }),
  ).toBe('(^_^) Referee No. 73 present · bets 3/4 · ⚑ green: tests passed, nothing changed since · debt 1')
  // the bets of a game are named only while its referee is present
  expect(statusLine({ mood: 'stern', present: false, bets: { won: 3, n: 4 }, debt: 2 })).toBe('(-_-) Referee · debt 2')
})
