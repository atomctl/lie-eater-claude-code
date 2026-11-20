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
  promptNumbers: [],
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

test('toRawCall reads the old and the new text of an edit and of a whole-file write', async () => {
  expect(
    toRawCall(
      { tool: 'Edit', file_path: 'tests/a.test.ts', old_string: 'expect(a).toBe(1)', new_string: '' },
      { result: {}, text: 'updated' },
    ),
  ).toEqual({ tool: 'Edit', path: 'tests/a.test.ts', oldText: 'expect(a).toBe(1)', newText: '', text: 'updated' })
  expect(
    toRawCall(
      { tool: 'Write', file_path: 'tests/a.test.ts', content: 'it.skip("a", () => {})' },
      { result: { originalFile: 'it("a", () => { expect(a).toBe(1) })' }, text: 'updated' },
    ),
  ).toMatchObject({ oldText: 'it("a", () => { expect(a).toBe(1) })', newText: 'it.skip("a", () => {})' })
  // a new file has no old content
  expect(
    toRawCall({ tool: 'Write', file_path: 'tests/b.test.ts', content: 'x' }, { result: { originalFile: null }, text: '' }),
  ).toMatchObject({ oldText: '', newText: 'x' })
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

test("nextMeta starts a turn and keeps the numbers of the person's prompts", async () => {
  expect(nextMeta(META, 'process 500 rows', false)).toMatchObject({ turn: 1, denies: 0, promptNumbers: ['500'] })
  // the mod's own prompt ("Fix this") must not make its numbers the person's
  expect(nextMeta(META, 'remove these numbers: 0.86', true)).toMatchObject({ turn: 1, denies: 0, promptNumbers: [] })

  const many = Array.from({ length: 60 }, (_, i) => String(100 + i)).join(' ')
  const kept = nextMeta(META, many, false).promptNumbers
  expect(kept).toHaveLength(50)
  expect(kept.at(-1)).toBe('159')
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

test('an edit of a test file carries the counts of the whole file as it was', async () => {
  const before = "it('adds', () => {\n  expect(add(1, 2)).toBe(3)\n})\n\nit('subtracts', () => {\n  expect(sub(3, 2)).toBe(1)\n})\n"
  const raw = toRawCall(
    { tool: 'Edit', file_path: 'tests/math.test.ts', old_string: "it('subtracts', () => {\n  expect(sub(3, 2)).toBe(1)\n})\n", new_string: '' },
    { result: { originalFile: before }, text: 'updated' },
  )
  const made = appendRecord([], raw, 1, 0).at(-1)

  expect(made?.testEdit).toMatchObject({ tests: [1, 0], asserts: [1, 0], file: { asserts: 2, tests: 2, skips: 0, tables: 0 } })
  // a new file has no counts from before
  const fresh = toRawCall({ tool: 'Write', file_path: 'tests/new.test.ts', content: before }, { result: { originalFile: null }, text: 'created' })
  expect(appendRecord([], fresh, 1, 0).at(-1)?.testEdit?.file).toBeUndefined()
})

// ---- from the review of Part 6 ----

test('toRawCall hands on where the project is and where the shell stood, for a shell call only', async () => {
  expect(toRawCall({ tool: 'Bash', command: 'rm a.py' }, { text: '' }, '/proj', '/proj/tests')).toEqual({
    tool: 'Bash',
    command: 'rm a.py',
    text: '',
    root: '/proj',
    stood: '/proj/tests',
  })
  expect(toRawCall({ tool: 'Read', file_path: '/proj/a.py' }, { text: '' }, '/proj', '/proj/tests')).toEqual({
    tool: 'Read',
    path: 'a.py',
    text: '',
  })
})
