import { expect, mock, test } from 'claude-code/testing'

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
