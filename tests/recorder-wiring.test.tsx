import { expect, mock, test } from 'claude-code/testing'

import { project, start, world } from './kit'

const PANE = {
  plugin: 'lie-eater',
  component: 'Pane',
  requestId: 'lie-eater',
  props: {
    title: 'Lie Eater',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('a failed test run shows in the pane, on every surface', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: 'Exit code 1', isError: true, text: 'Exit code 1\n3 failed, 31 passed in 2.10s' }))

  await $.tool.call({ tool: 'Bash', command: 'pytest' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /pytest/ }))?.text).toBe('#1 test ✗ pytest')
    expect((await ui.find({ type: 'Text', text: /Calls recorded/ }))?.text).toBe('Calls recorded: 1 (#1 to #1)')
    await ui.unmount()
  }
})

test('the recorder hands back the result it got, unchanged', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: 'Exit code 1', isError: true, text: 'Exit code 1' }))

  const ran = await $.tool.call({ tool: 'Bash', command: 'false' })

  expect(ran).toMatchObject({ result: 'Exit code 1', isError: true, text: 'Exit code 1' })
})

test('the record keeps the newest 200 calls', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))

  for (let i = 0; i < 205; i += 1) {
    await $.tool.call({ tool: 'Bash', command: `echo ${i}` })
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Calls recorded/ }))?.text).toBe('Calls recorded: 200 (#6 to #205)')
  expect((await ui.find({ type: 'Text', text: /^#205 / }))?.text).toBe('#205 other ✓ echo 204')
  await ui.unmount()
})

test('an edit and a subagent run are recorded too', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: {}, text: '34 passed in 1s' }))

  await $.tool.call({ tool: 'Edit', file_path: 'tests/a.test.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'pytest', agentId: 'a1' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^#1 / }))?.text).toBe('#1 edit ✓ tests/a.test.ts')
  expect((await ui.find({ type: 'Text', text: /^#2 / }))?.text).toBe('#2 test ✓ pytest')
  await ui.unmount()
})

test('a refused call is not recorded', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ deny: 'no' }))

  await $.tool.call({ tool: 'Bash', command: 'rm -rf /' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /No tool calls/ }))?.text).toBe('No tool calls yet.')
  await ui.unmount()
})

test('state from an older version is declined, and a second start does not fail', async ($, on) => {
  on('command.register', () => ({ value: { command: 'lie-eater' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('state.get', () => ({ value: { value: [{ tool: 'Bash' }], version: 1 } }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /No tool calls/ }))?.text).toBe('No tool calls yet.')
  await ui.unmount()
})

test('a long command is cut to the width of the pane', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))

  await $.tool.call({ tool: 'Bash', command: `echo ${'x'.repeat(200)}` })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^#1 / }))?.text).toHaveLength(60)
  await ui.unmount()
})

// ---- from the staged games ----

const done = ($: Parameters<typeof start>[0]) => $.tool.call({ tool: 'mcp__lie-eater__done' } as never).then(out => String(out.result))
const bet = ($: Parameters<typeof start>[0]) => $.tool.call({ tool: 'mcp__lie-eater__bet', expect: 'pass', confidence: 0.9 } as never)

test('a file is named by its path inside the project, and a folder above the project decides nothing', async ($, on) => {
  // the project lies under a folder named "tests": that makes none of its files a test file
  world(on, { ...project(), root: '/home/me/tests/calc' })
  on('tool.call', () => ({ result: {}, text: '34 passed in 1s' }))

  await start($)
  await $.tool.call({
    tool: 'Edit',
    file_path: '/home/me/tests/calc/src/price.ts',
    old_string: 'assert(count > 0)\nreturn count * unit',
    new_string: 'return count * unit',
  })
  await bet($)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  const out = await done($)

  expect(out).toContain('✓ No check was removed from a test')
  expect(out.split('\n')[0]).toBe('✓ checked')
})

test('a result names a test file by its path inside the project', async ($, on) => {
  const files: Record<string, string> = { 'package.json': '{"scripts":{"test":"vitest run"}}', 'price.test.ts': "it('adds', () => {})" }
  world(on, { root: '/home/me/calc', files, dirs: { tests: ['price.test.ts'] } })
  on('tool.call', () => ({ result: {}, text: '34 passed in 1s' }))

  await start($)
  await $.tool.call({
    tool: 'Edit',
    file_path: '/home/me/calc/tests/price.test.ts',
    old_string: "it('adds', () => {",
    new_string: "it.skip('adds', () => {",
  })
  files['price.test.ts'] = "it.skip('adds', () => {})"
  const out = await done($)

  expect(out).toContain('The AI switched off 1 check in tests/price.test.ts.')
  expect(out).toContain('    tests/price.test.ts: new skip or only marks: 1')
  expect(out).not.toContain('/home/me')
})

// ---- from the review of Part 6 ----

test('removing a cache in front of the test run deletes no test', async ($, on) => {
  world(on, { ...project(), root: '/home/me/calc' })
  on('tool.call', () => ({ result: {}, text: 'Tests: 12 passed, 12 total' }))

  await start($)
  await bet($)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf node_modules/.cache && npm test' })
  const out = await done($)

  expect(out).toContain('✓ No test was deleted')
  // in a chain the run proves nothing: not checked, never "don't trust"
  expect(out.split('\n')[0]).toBe('? not checked')
})

test('a full check of a runner Lie Eater does not know is read by how it exits; behind a pipe it is not read', async ($, on) => {
  world(on)
  on('tool.call', () => ({ result: {}, text: 'all good' }))

  await start($)
  await $.command.run({ command: 'check', args: 'make ci' } as never)
  await bet($)
  await $.tool.call({ tool: 'Bash', command: 'make ci 2>&1 | tail -5' })

  expect((await done($)).split('\n').slice(0, 2)).toEqual([
    '? not checked',
    'The check ran inside a longer command, so its result cannot be trusted.',
  ])

  await bet($)
  await $.tool.call({ tool: 'Bash', command: 'make ci' })

  expect((await done($)).split('\n')[0]).toBe('✓ checked')
})
