// What the mod reads from the person's project: the files that name a test
// command, and the walk over its folders. It reads; it changes nothing.
import type { EngineInterface } from 'claude-code'

import { hash, isFrozen } from './frozen'

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

// Folders that hold no tests of the project. A folder whose name starts with a dot is left out too
// (`.git`, `.lie-eater`, `.venv`).
const NOT_THE_PROJECT = new Set(['node_modules', 'venv', 'env', 'dist', 'build', 'target', 'vendor', '__pycache__'])
// A project with more folders or files than this, or a folder that cannot be listed, is not read
// to its end: no fingerprint, and no result better than "not checked".
const FOLDERS_WALKED = 400
const NAMES_KEPT = 5000

/** The project's files by their paths inside it, and its fingerprint; `print` is absent when the walk is not whole. */
export type Walked = { names: string[]; print?: string }

/**
 * Walks the project (or the folder `from` inside it) at any depth, one folder
 * at a time: `$.fs.list` reads one folder. The fingerprint is a hash of each
 * file's path, size and modification time, from the listing; a frozen check
 * file is read, and stands in it by the hash of its text.
 */
export async function walk($: EngineInterface, from = ''): Promise<Walked> {
  const root = await inProject($)
  const names: string[] = []
  const stamps: string[] = []
  const folders = [from]
  let isWhole = true
  let i = 0

  for (; i < folders.length && i < FOLDERS_WALKED && names.length < NAMES_KEPT; i += 1) {
    const folder = folders[i] ?? ''
    const at = folder === '' ? root : root === '' ? folder : `${root}/${folder}`
    const entries = await (at === '' ? $.fs.list() : $.fs.list(at)).catch(() => {
      isWhole = false

      return []
    })

    for (const entry of entries) {
      const name = folder === '' ? entry.name : `${folder}/${entry.name}`

      if (entry.kind !== 'dir') {
        names.push(name)
        // A check file by its text: put back after a run with its old size and time, it would look untouched.
        const text = isFrozen(name) ? await $.fs.read(`${at === '' ? '' : `${at}/`}${entry.name}`).catch(() => undefined) : undefined
        stamps.push(text === undefined ? `${name}\t${entry.size}\t${entry.mtimeMs}` : `${name}\t${hash(text)}`)
      } else if (!entry.name.startsWith('.') && !NOT_THE_PROJECT.has(entry.name)) {
        folders.push(name)
      }
    }
  }

  isWhole &&= i >= folders.length && names.length < NAMES_KEPT

  return { names, ...(isWhole ? { print: hash(stamps.sort().join('\n')) } : {}) }
}
