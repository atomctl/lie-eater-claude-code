import { expect, test } from 'claude-code/testing'

import { refereeNumber } from '../hooks/lib/flag'
import { bash, bet, betRun, paneLines, run, world } from './kit'

const failing = () => ({ result: 'Exit code 1', isError: true as const, text: 'Exit code 1\n3 failed, 31 passed in 2.10s' })
const passing = () => ({ result: {}, text: '34 passed in 1s' })
const has = (lines: string[], text: string) => lines.some(l => l.includes(text))
const start = ($: Parameters<typeof run>[0]) => $.session.start({ cwd: '/home/me/calc', surface: 'terminal', isInteractive: true })
const editCode = ($: Parameters<typeof run>[0]) =>
  $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
const PKG = { 'package.json': '{"scripts":{"test":"vitest run"}}' }
const REMOTE = 'git@github.com:someone/calc.git'
const GIT = { config: `[remote "origin"]\n\turl = ${REMOTE}\n` }

test('the referee is there from the start of the session, with the number of this repository', async ($, on) => {
  const seen = world(on, { files: { ...PKG, ...GIT } })

  await start($)

  expect(seen.status.at(-1)).toBe(`(o_o) Referee No. ${refereeNumber(REMOTE)}`)
  expect(seen).toMatchObject({ opens: 0, classified: 0, toasts: [] })
})

test('with no git remote the number comes from the name of the folder', async ($, on) => {
  const seen = world(on, { files: PKG })

  await start($)

  expect(seen.status.at(-1)).toBe(`(o_o) Referee No. ${refereeNumber('calc')}`)
})

test('the flag follows the work with no summon: no bet, no refusal, no model call', async ($, on) => {
  const seen = world(on, { files: PKG })
  let isGreen = true
  let denied = 0
  on('tool.call', () => (isGreen ? passing() : failing()))
  const flag = () => seen.status.at(-1)?.split(' · ').find(part => part.startsWith('⚑'))
  const face = () => seen.status.at(-1)?.slice(0, 5)

  await start($)
  expect(flag()).toBeUndefined()
  await editCode($)
  expect(flag()).toBe('⚑ yellow: code changed, tests not run yet')
  expect(face()).toBe('(o_o)')
  if ((await bash($, 'npm test')).deny !== undefined) denied += 1
  expect(flag()).toBe('⚑ green: tests passed, nothing changed since')
  expect(face()).toBe('(^_^)')
  await editCode($)
  expect(flag()).toBe('⚑ yellow: code changed since the last test run')
  isGreen = false
  if ((await bash($, 'npx vitest run')).deny !== undefined) denied += 1
  expect(flag()).toBe('⚑ red: tests fail')
  expect(face()).toBe('(-_-)')

  expect(denied).toBe(0)
  expect(seen).toMatchObject({ opens: 0, classified: 0, toasts: [], sounds: 0 })
})

test('with no config file the first plain test run starts the watch', async ($, on) => {
  const seen = world(on)
  on('tool.call', passing)

  await start($)
  await editCode($)
  expect(seen.status.at(-1)).toBe(`(o_o) Referee No. ${refereeNumber('calc')}`)
  await bash($, 'pytest -q 2>&1 | tail -5')
  expect(seen.status.at(-1)).toContain('⚑ green: tests passed, nothing changed since')
})

test('in a game the status names the referee as present, his bets and the flag', async ($, on) => {
  const seen = world(on, { files: PKG })
  on('tool.call', passing)

  await start($)
  await run($, 'summon')
  expect(seen.status.at(-1)).toBe(`(o_o) Referee No. ${refereeNumber('calc')} present`)
  await editCode($)
  await bet($)
  expect(seen.status.at(-1)?.startsWith('(O_O) ')).toBe(true)
  await bash($, 'npm test')
  expect(seen.status.at(-1)).toBe(
    `(^_^) Referee No. ${refereeNumber('calc')} present · bets 1/1 · ⚑ green: tests passed, nothing changed since`,
  )
  expect(has(await paneLines($), `THE REFEREE IS PRESENT · No. ${refereeNumber('calc')} · game 1`)).toBe(true)
})

test('a broken game leaves a stern face and the debt in the status', async ($, on) => {
  const seen = world(on, { files: PKG })
  on('tool.call', failing)

  await start($)
  await run($, 'summon')
  await betRun($, 'npm test', 'fail')
  await run($, 'rule')

  expect(seen.status.at(-1)).toBe(`(-_-) Referee No. ${refereeNumber('calc')} · ⚑ red: tests fail · debt 1`)
})
