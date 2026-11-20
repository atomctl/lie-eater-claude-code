// What the mod reads from the person's project to find the test command.
// It reads; it changes nothing.
import type { EngineInterface } from 'claude-code'

const PROJECT_FILES = ['package.json', 'pyproject.toml', 'pytest.ini', 'Cargo.toml', 'go.mod', 'Makefile']

/** The project's root, absolute; '' when the engine names none. */
export async function projectRoot($: EngineInterface): Promise<string> {
  return $.session.root().catch(() => '')
}

/**
 * A path of the project, made absolute. `$.fs` reads a relative path from
 * where the AI's shell stands, and a `cd packages/api` by the AI moves that:
 * the ledger and the receipts must not follow it.
 */
export async function inProject($: EngineInterface, path = ''): Promise<string> {
  const root = await projectRoot($)

  return root === '' ? path : path === '' ? root : `${root}/${path}`
}

/** The config files that can name a test command; a file that is not there is undefined. */
export async function projectFiles($: EngineInterface): Promise<Record<string, string | undefined>> {
  const paths = await Promise.all(PROJECT_FILES.map(name => inProject($, name)))
  const texts = await Promise.all(paths.map(path => $.fs.read(path).catch(() => undefined)))

  return Object.fromEntries(PROJECT_FILES.map((name, i) => [name, texts[i]]))
}

// Folders that hold no tests of the project. A folder whose name starts with a dot is left out too.
const NOT_THE_PROJECT = new Set(['node_modules', 'venv', 'env', 'dist', 'build', 'target', 'vendor', '__pycache__'])
// shortcut: a project with more folders or files than this is not walked to its end, so a test file
// behind the limit is not in a game's snapshot; raise the limits when a real project hits them.
const FOLDERS_WALKED = 400
const NAMES_KEPT = 5000

/**
 * The names of the project's files, by their paths inside the project, at any
 * depth: a test file deeper down (`src/__tests__/a.test.ts`) is measured too.
 * `$.fs.list` reads one folder, so the folders are walked one by one.
 */
export async function projectNames($: EngineInterface): Promise<string[]> {
  const root = await inProject($)
  const names: string[] = []
  const folders = ['']

  for (let i = 0; i < folders.length && i < FOLDERS_WALKED && names.length < NAMES_KEPT; i += 1) {
    const folder = folders[i] ?? ''
    const at = folder === '' ? root : root === '' ? folder : `${root}/${folder}`
    const entries = await (at === '' ? $.fs.list() : $.fs.list(at)).catch(() => [])

    for (const entry of entries) {
      const name = folder === '' ? entry.name : `${folder}/${entry.name}`

      if (entry.kind !== 'dir') names.push(name)
      else if (!entry.name.startsWith('.') && !NOT_THE_PROJECT.has(entry.name)) folders.push(name)
    }
  }

  return names
}
