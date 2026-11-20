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

/** The names of the files in the project's folder and in its test folders. */
export async function projectNames($: EngineInterface): Promise<string[]> {
  const here = await inProject($)
  const [root, tests, test] = await Promise.all([
    (here === '' ? $.fs.list() : $.fs.list(here)).catch(() => []),
    $.fs.list(await inProject($, 'tests')).catch(() => []),
    $.fs.list(await inProject($, 'test')).catch(() => []),
  ])

  return [...root.map(e => e.name), ...tests.map(e => `tests/${e.name}`), ...test.map(e => `test/${e.name}`)]
}
