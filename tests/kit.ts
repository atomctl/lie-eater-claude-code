// Shared stand-ins for the engine, for the wiring tests. Each hook here answers
// what the engine would; `seen` records what the mod asked for.
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

// The kit does not export the type of a test's `on`; the clock mock takes one.
type On = Parameters<typeof mock.clock>[0]

export const PANE = {
  plugin: 'lie-eater',
  component: 'Pane',
  requestId: 'lie-eater',
  props: {
    title: 'Lie Eater',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

// What the small model answers to the one question it is asked.
export const DONE = 'DONE'
export const NOT_DONE = 'NOT'

export type Seen = {
  toasts: string[]
  sounds: number
  opens: number
  status: (string | undefined)[]
  prompts: { text: string; asUser: boolean }[]
  classified: number
  /** The last "said done" request the mod made. */
  asked?: { model: string; system?: unknown; prompt: unknown; maxTokens?: number }
  written: Record<string, string>
  tools: { name: string; inputSchema?: unknown; isDeferred?: unknown }[]
  redraws: number
  /** Lets the mod's timers run: a prompt the mod sends goes out a moment later. */
  tick: () => Promise<void>
}

export type World = {
  files?: Record<string, string>
  /** File names in the project's folder, and in its `tests` folder under the key `tests`. */
  dirs?: { root?: string[]; tests?: string[] }
  label?: () => string | Promise<string>
  /** How long the sound takes; left out, it ends at once. */
  sound?: () => Promise<void>
  /** What opening the pane does; left out, it is placed. */
  open?: () => void
  /** The project's root, absolute. Left out, the engine names none. */
  root?: string
}

export function world(on: On, opts: World = {}): Seen {
  const clock = mock.clock(on)
  const seen: Seen = {
    toasts: [],
    sounds: 0,
    opens: 0,
    status: [],
    prompts: [],
    classified: 0,
    written: {},
    tools: [],
    redraws: 0,
    tick: () => clock.advance(5),
  }
  const files = opts.files ?? {}
  const named = (path: string) => path.split('/').at(-1) ?? path
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => {
    seen.tools.push(e)

    return { value: { tool: `mcp__lie-eater__${e.name}` } }
  })
  on('ui.invalidate', () => {
    seen.redraws += 1

    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => {
    if (opts.root === undefined) {
      throw new Error('no project root')
    }

    return { value: opts.root }
  })
  on('ui.open', () => {
    seen.opens += 1
    opts.open?.()

    return { value: { isPlaced: true } }
  })
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    seen.status.push(e.text)

    return { value: undefined }
  })
  on('audio.play', async () => {
    seen.sounds += 1
    await opts.sound?.()

    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    const text = files[named(e.path)] ?? seen.written[e.path]

    if (text === undefined) {
      throw new Error(`no such file: ${e.path}`)
    }

    return { value: text }
  })
  on('fs.exists', (_, e) => ({ value: files[named(e.path)] !== undefined || seen.written[e.path] !== undefined }))
  on('fs.list', (_, e) => {
    const folder = named(e.path ?? '')
    const names = (folder === 'tests' || folder === 'test' ? opts.dirs?.tests : opts.dirs?.root) ?? []

    return { value: names.map(name => ({ name, kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('fs.write', (_, e) => {
    seen.written[e.path] = e.text

    return { value: undefined }
  })
  on('model.complete', async (_, e) => {
    seen.classified += 1
    seen.asked = e as never
    const text = await (opts.label?.() ?? NOT_DONE)

    return { value: { isAnswered: true, text, usage: {} } as never }
  })
  on('prompt.submit', (_, e) => {
    const origin = e.origin as { asUser?: boolean } | undefined
    seen.prompts.push({ text: e.text, asUser: origin?.asUser === true })

    return { text: e.text }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))

  return seen
}

/** Every line of text the pane shows now. */
export async function paneLines($: Engine): Promise<string[]> {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const lines = (await ui.findAll({ type: 'Text' })).map(el => el.text ?? '')
  await ui.unmount()

  return lines
}

/** The pane's lines, once `ready` holds; the ruling arrives a moment after the turn. */
export async function paneWhen($: Engine, ready: (lines: string[]) => boolean): Promise<string[]> {
  let lines = await paneLines($)

  for (let i = 0; i < 50 && !ready(lines); i += 1) {
    lines = await paneLines($)
  }

  return lines
}

export const run = ($: Engine, command: string, args = '') => $.command.run({ command, args } as never)
export const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command })
export const bet = ($: Engine, expect: 'pass' | 'fail' = 'pass', confidence = expect === 'pass' ? 0.9 : 0.55) =>
  $.tool.call({ tool: 'mcp__lie-eater__bet', expect, confidence } as never)
/** A bet, then the run: while a referee is present a test run needs its bet. */
export const betRun = async ($: Engine, command: string, expect: 'pass' | 'fail' = 'pass') => {
  await bet($, expect)

  return bash($, command)
}
export const endTurn = ($: Engine, answer: string, more: Record<string, unknown> = {}) =>
  $.turn.complete({ answer, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1', ...more } as never)
