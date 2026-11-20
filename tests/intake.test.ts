import { expect, test } from 'claude-code/testing'

import { appendRecord, nextMeta, toRawCall } from '../hooks/lib/intake'
import type { Meta } from '../types'
import { rec } from './helpers'

const META: Meta = {
  seq: 0,
  betSeq: 0,
  rulingSeq: 0,
  termsSeq: 0,
  turn: 0,
  denies: 2,
  unbet: 0,
}

test('toRawCall reads a shell call and how it ended', async () => {
  expect(
    toRawCall({ tool: 'Bash', command: 'pytest', tool_use_id: 't1' }, { result: 'Exit code 1', isError: true, text: 'Exit code 1' }),
  ).toEqual({ tool: 'Bash', command: 'pytest', text: 'Exit code 1', isError: true })
  expect(
    toRawCall({ tool: 'Bash', command: 'sleep 2', run_in_background: true }, { result: { backgroundTaskId: 'b1' }, text: 'Command running in background' }),
  ).toMatchObject({ isBackground: true })
  expect(toRawCall({ tool: 'Bash', command: 'sleep 2' }, { result: { backgroundTaskId: 'b1' }, text: '' })).toMatchObject({
    isBackground: true,
  })
  expect(toRawCall({ tool: 'Bash', command: 'npm test' }, { result: { interrupted: true }, text: '' })).toMatchObject({
    isInterrupted: true,
  })
  expect(toRawCall({ tool: 'Bash', command: 'pytest', agentId: 'a1' }, { result: {}, text: 'ok' }).agentId).toBe('a1')
})

test('toRawCall reads the new text of an edit and of a whole-file write', async () => {
  expect(
    toRawCall(
      { tool: 'Edit', file_path: 'tests/a.test.ts', old_string: 'expect(a).toBe(1)', new_string: '' },
      { result: {}, text: 'updated' },
    ),
  ).toEqual({ tool: 'Edit', path: 'tests/a.test.ts', newText: '', text: 'updated' })
  expect(
    toRawCall(
      { tool: 'Write', file_path: 'tests/a.test.ts', content: 'it.skip("a", () => {})' },
      { result: { originalFile: 'it("a", () => { expect(a).toBe(1) })' }, text: 'updated' },
    ),
  ).toEqual({ tool: 'Write', path: 'tests/a.test.ts', newText: 'it.skip("a", () => {})', text: 'updated' })
  expect(toRawCall({ tool: 'Read', file_path: 'src/a.py' }, { result: {}, text: 'x = 1' })).toEqual({
    tool: 'Read',
    path: 'src/a.py',
    text: 'x = 1',
  })
})

test('appendRecord gives the next id and keeps the newest 200', async () => {
  const one = appendRecord([], { tool: 'Bash', command: 'ls' }, 3, 1000)
  expect(one).toMatchObject([{ id: 1, turn: 3, at: 1000 }])

  const full = Array.from({ length: 200 }, (_, i) => rec({ id: i + 1 }))
  const next = appendRecord(full, { tool: 'Bash', command: 'ls' }, 1, 0)
  expect(next).toHaveLength(200)
  expect(next[0]?.id).toBe(2)
  expect(next.at(-1)?.id).toBe(201)
})

test('nextMeta starts a turn', async () => {
  expect(nextMeta({ ...META, turn: 4, denies: 2 })).toMatchObject({ turn: 5, denies: 0 })
})

test('toRawCall names a file by its path inside the project', async () => {
  const ran = { result: {}, text: '' }
  const edit = (file_path: string) => toRawCall({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' }, ran, '/home/me/tests/calc')

  expect(edit('/home/me/tests/calc/src/price.ts').path).toBe('src/price.ts')
  expect(edit('/home/me/tests/calc/tests/price.test.ts').path).toBe('tests/price.test.ts')
  // a file outside the project keeps its whole path
  expect(edit('/etc/hosts').path).toBe('/etc/hosts')
  expect(edit('/home/me/tests/calc2/src/a.ts').path).toBe('/home/me/tests/calc2/src/a.ts')
  // with no root known, the path stays as the engine gave it
  expect(toRawCall({ tool: 'Edit', file_path: '/home/me/a.ts', old_string: 'a', new_string: 'b' }, ran).path).toBe('/home/me/a.ts')
})
