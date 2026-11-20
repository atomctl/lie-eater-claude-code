// Shared stand-ins for the engine, for the wiring tests. Each hook here answers
// what the engine would; `seen` records what the mod asked for.
import { mock } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

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

export type Seen = {
  toasts: string[]
  sounds: number
  opens: number
  /** The panes the mod closed, by id. */
  closes: string[]
  status: (string | undefined)[]
  prompts: { text: string; asUser: boolean }[]
  /** Model calls the mod made: the referee makes none. */
  classified: number
  written: Record<string, string>
  tools: { name: string; inputSchema?: unknown; isDeferred?: unknown }[]
  redraws: number
  /** Lets the mod's timers run: a prompt the mod sends goes out a moment later. */
  tick: () => Promise<void>
}

export type World = {
  files?: Record<string, string>
  /** File names in the project's folder, and in its `tests` folder under the key `tests`. A listed file's size and time follow its text in `files`. */
  dirs?: { root?: string[]; tests?: string[]; deep?: Record<string, string[]> }
  /** Every file keeps one modification time, whatever its text (`cp -p`, `touch -r`). */
  sameTimes?: boolean
  /** How long the sound takes; left out, it ends at once. */
  sound?: () => Promise<void>
  /** What opening the pane does; left out, it is placed. */
  open?: () => void
  /** The project's root, absolute. Left out, the engine names none. */
  root?: string
  /** Folders whose listing fails. */
  unlisted?: string[]
  /** Where the AI's shell stands, absolute; read when asked. Left out: the root (and none when no root). */
  cwd?: string
}

// A file's time in the kit: it moves when the text does.
const stamp = (text: string): number => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1_000_000_007, 7)

export function world(on: On, opts: World = {}): Seen {
  const clock = mock.clock(on)
  const seen: Seen = {
    toasts: [],
    sounds: 0,
    opens: 0,
    closes: [],
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
  on('session.cwd', () => {
    const cwd = opts.cwd ?? opts.root

    if (cwd === undefined) {
      throw new Error('no folder')
    }

    return { value: cwd }
  })
  on('ui.open', () => {
    seen.opens += 1
    opts.open?.()

    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    seen.closes.push(e.id)

    return { value: undefined }
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
  on('fs.list', (_, e) => {
    // Each file's size and time follow its text, so a change of a file changes the listing.
    const entry = (name: string, kind: 'file' | 'dir', text = files[name] ?? '') => ({ name, kind, size: text.length, mtimeMs: opts.sameTimes === true ? 0 : stamp(text), isLink: false })
    const asked = e.path ?? ''
    // The mod's own folder (the demo's): the files the mod wrote there, or a file a test put there.
    const own = Object.keys(seen.written).filter(path => {
      const folder = path.slice(0, path.lastIndexOf('/'))

      return folder === asked || asked.endsWith(`/${folder}`)
    })
    if (asked.includes('.lie-eater')) return { value: own.map(path => entry(named(path), 'file', files[named(path)] ?? seen.written[path])) }
    // `dirs.tests` is the `tests` folder; `dirs.deep` maps any other folder to its file names.
    const tree: Record<string, string[]> = { ...opts.dirs?.deep, ...(opts.dirs?.tests ? { tests: opts.dirs.tests } : {}) }
    // Which folder of the tree the path names (`/home/me/calc/src/__tests__`); any other path is the project's root.
    const known = Object.keys(tree).flatMap(path => path.split('/').map((_, i, parts) => parts.slice(0, i + 1).join('/')))
    const folder = known.filter(path => asked === path || asked.endsWith(`/${path}`)).sort((a, b) => b.length - a.length)[0] ?? ''
    const inside = Object.keys(tree)
      .filter(path => (folder === '' ? true : path.startsWith(`${folder}/`)))
      .map(path => (folder === '' ? path : path.slice(folder.length + 1)).split('/')[0] ?? '')
    const names = folder === '' ? (opts.dirs?.root ?? []) : (tree[folder] ?? [])
    if (opts.unlisted?.includes(folder) === true) throw new Error(`cannot list ${asked}`)

    return { value: [...names.map(name => entry(name, 'file')), ...[...new Set(inside)].map(name => entry(name, 'dir'))] }
  })
  on('fs.write', (_, e) => {
    seen.written[e.path] = e.text

    return { value: undefined }
  })
  on('model.complete', () => {
    seen.classified += 1

    return { value: { isAnswered: true, text: '', usage: {} } as never }
  })
  on('prompt.submit', (_, e) => {
    const origin = e.origin as { asUser?: boolean } | undefined
    seen.prompts.push({ text: e.text, asUser: origin?.asUser === true })

    return { text: e.text }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))

  return seen
}

/** The words among drawn Texts: Munch's face, drawn of blocks, is left out (tests/munch.test.tsx checks it). */
export const words = (found: readonly { text?: string }[]): string[] => found.map(el => el.text ?? '').filter(text => !/^(?=.*[█▀▄])[ █▀▄]+$/.test(text))

/** Every line of words the pane shows now. */
export async function paneLines($: Engine): Promise<string[]> {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const lines = words(await ui.findAll({ type: 'Text' }))
  await ui.unmount()

  return lines
}

/** Shows Details in a mounted pane, as the person pressing `d` does, when they are hidden. Hands the pane back. */
export async function showDetails<U extends Pick<Mounted, 'find' | 'press'>>(ui: U): Promise<U> {
  if ((await ui.find({ type: 'Text', text: /^Details$/ })) === undefined) await ui.press({ key: 'details' })

  return ui
}

/** Every line of words the pane shows with Details open. */
export async function detailLines($: Engine): Promise<string[]> {
  const ui = await showDetails(await $.ui.mount({ ...PANE, surface: 'terminal' }))
  const lines = words(await ui.findAll({ type: 'Text' }))
  await ui.unmount()

  return lines
}

export const run = ($: Engine, command: string, args = '') => $.command.run({ command, args } as never)
export const start = ($: Engine) => $.session.start({ cwd: '/home/me/calc', surface: 'terminal', isInteractive: true })
/** The person types a prompt and presses Enter. */
export const prompt = ($: Engine, text = 'go on') => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false } as never)
export const editCode = ($: Engine, path = 'src/a.ts') => $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' })
/** The AI edits a file of the project, and the file really changes (`editCode` alone changes no file). */
export const editFile = ($: Engine, files: Record<string, string>, name = 'a.ts') => {
  files[name] = `${files[name] ?? ''}// changed\n`

  return editCode($, name)
}

export const PKG = '{"scripts":{"test":"vitest run"}}'
export const MATH = "it('adds', () => {\n  expect(add(1, 2)).toBe(3)\n})\n\nit('subtracts', () => {\n  expect(sub(3, 2)).toBe(1)\n})\n"
/**
 * A project with checks: `npm test` in package.json, one test file and one
 * source file. `files` may be changed by the test: a changed text is a changed file.
 */
export const project = (
  files: Record<string, string> = { 'package.json': PKG, 'math.test.ts': MATH, 'a.ts': 'export const a = 1\n' },
): World & { files: Record<string, string>; dirs: { root: string[]; tests: string[] } } => ({
  files,
  dirs: { root: ['package.json', 'a.ts'], tests: ['math.test.ts'] },
})
export const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command })
export const bet = ($: Engine, expect: 'pass' | 'fail' = 'pass', confidence = expect === 'pass' ? 0.9 : 0.55) =>
  $.tool.call({ tool: 'mcp__lie-eater__bet', expect, confidence } as never)
/** A bet, then the run: while a referee is present a test run needs its bet. */
export const betRun = async ($: Engine, command: string, expect: 'pass' | 'fail' = 'pass') => {
  await bet($, expect)

  return bash($, command)
}
/** The AI says the task is finished; `broken` is what it names as broken. */
export const done = ($: Engine, broken?: string, more: Record<string, unknown> = {}) =>
  $.tool.call({ tool: 'mcp__lie-eater__done', ...(broken === undefined ? {} : { broken }), ...more } as never)
export const endTurn = ($: Engine, answer: string, more: Record<string, unknown> = {}) =>
  $.turn.complete({ answer, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1', ...more } as never)
