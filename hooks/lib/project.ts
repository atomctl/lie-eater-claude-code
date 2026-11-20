// What the mod reads from the person's project to find the test command.
// It reads; it changes nothing.
import type { EngineInterface } from 'claude-code'

const PROJECT_FILES = ['package.json', 'pyproject.toml', 'pytest.ini', 'Cargo.toml', 'go.mod', 'Makefile']

/** The config files that can name a test command; a file that is not there is undefined. */
export async function projectFiles($: EngineInterface): Promise<Record<string, string | undefined>> {
  const texts = await Promise.all(PROJECT_FILES.map(name => $.fs.read(name).catch(() => undefined)))

  return Object.fromEntries(PROJECT_FILES.map((name, i) => [name, texts[i]]))
}

/** The names of the files in the project's folder and in its test folders. */
export async function projectNames($: EngineInterface): Promise<string[]> {
  const [root, tests, test] = await Promise.all([
    $.fs.list().catch(() => []),
    $.fs.list('tests').catch(() => []),
    $.fs.list('test').catch(() => []),
  ])

  return [...root.map(e => e.name), ...tests.map(e => `tests/${e.name}`), ...test.map(e => `test/${e.name}`)]
}
