// The check files, frozen when the watch is armed, and what became of each by
// `done`. Lie Eater compares files: it reads no meaning from their text.
// Plain functions; nothing here talks to the engine.
import type { Change, Frozen, Kept } from '../../types'
import { isTestFile } from './record'

const TEXT_KEPT = 200_000

/**
 * A small plain hash: two FNV-1a passes with different starts (64 bits in
 * all), with the length beside it. It guards against accidents, not against a
 * forger: two texts with one hash can be made on purpose.
 */
export function hash(text: string): string {
  const pass = (h: number): string => {
    for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)

    return (h >>> 0).toString(16).padStart(8, '0')
  }

  return `${pass(0x811c9dc5)}${pass(0x050c5d1f)}:${text.length}`
}

// The files that decide how the checks run, at any depth.
const CONFIG =
  /(?:^|\/)(?:package\.json|pytest\.ini|pyproject\.toml|setup\.cfg|tox\.ini|noxfile\.py|conftest\.py|(?:GNU)?[Mm]akefile|\.rspec|phpunit\.xml[^/]*|karma\.conf\.[^/]+|(?:jest|vitest|vite|playwright|babel)\.config\.[^/]+|(?:jest|vitest)\.setup\.[^/]+|setupTests\.[^/]+|\.babelrc|\.nycrc[^/]*|\.coveragerc|\.mocharc\.[^/]+)$/

export const decidesHowChecksRun = (path: string): boolean => CONFIG.test(path)

/** In the frozen set: every file in a test folder, every test-named file, and the files that decide how the checks run. */
export const isFrozen = (path: string): boolean => isTestFile(path) || decidesHowChecksRun(path)

/**
 * The check files that are new since the watch was armed (or armed again):
 * test-named files and files in a test folder that are in the walk now and
 * not in the frozen set, that hold a check: a test or an assertion, by the
 * words every runner uses. An empty file or a helper is no new check. It is a
 * note on a green result, never what decides one. Sorted, so that the first
 * named is always the same. `now`: the new files as they were read.
 */
const HOLDS_A_CHECK = /\bassert|\bexpect\s*\(|\bdef test_|\b(?:it|test)\s*(?:\.\w+\s*)*\(|\bfunc Test|#\[test\]|@Test\b|\.should\b/

export const newChecks = (was: Frozen, names: readonly string[], now: Record<string, Kept>): string[] =>
  names
    .filter(name => isTestFile(name) && !decidesHowChecksRun(name) && !(name in was.files) && !was.unread.includes(name))
    // A file too large to keep as text cannot be looked at: it counts.
    .filter(name => { const kept = now[name]; return kept !== undefined && (!('text' in kept) || HOLDS_A_CHECK.test(kept.text)) })
    .sort()

// Of a package.json only what decides the checks counts: an added dependency or a `lint` script changes none.
function checksPart(text: string): string {
  try {
    const { scripts, type, imports, jest, vitest, mocha } = JSON.parse(text) as Record<string, unknown>
    const { test, pretest, posttest } = (scripts ?? {}) as Record<string, unknown>

    return JSON.stringify({ test, pretest, posttest, type, imports, jest, vitest, mocha })
  } catch {
    return text
  }
}

// The sections of a pyproject.toml or a setup.cfg that decide the checks.
const CHECK_SECTION = /^\[\[?\s*(?:tool\.(?:pytest|coverage|tox|nox)\b|tool:pytest\b|coverage:|tox\b|pytest\b)/

// Of such a file only those sections count: a new dependency or a linter's setting changes no check.
function checkSections(text: string): string {
  let isIn = false

  return text
    .split('\n')
    .filter(line => {
      if (/^\s*\[/.test(line)) isIn = CHECK_SECTION.test(line.trim())

      return isIn
    })
    .join('\n')
}

/** One check file as it is frozen. `room`: how much text the frozen set may still keep. */
export function keep(path: string, text: string, room = Infinity): Kept {
  const kept = /(?:^|\/)package\.json$/.test(path) ? checksPart(text) : /(?:^|\/)(?:pyproject\.toml|setup\.cfg)$/.test(path) ? checkSections(text) : text

  return kept.length <= Math.min(TEXT_KEPT, room) ? { text: kept } : { hash: hash(kept) }
}

// In a new check file: jest, vitest and mocha then run that test alone and skip the rest.
const RUNS_ONLY = /\.only\s*\(|(?<![.\w])f(?:it|describe)\s*\(/

const hashOf = (k: Kept): string => ('text' in k ? hash(k.text) : k.hash)

// The lines of `a` that `b` does not hold, each line counted as often as it stands.
function missing(a: readonly string[], b: readonly string[]): string[] {
  const left = new Map<string, number>()
  for (const line of b) left.set(line, (left.get(line) ?? 0) + 1)

  return a.filter(line => {
    const n = left.get(line) ?? 0
    left.set(line, n - 1)

    return n <= 0
  })
}

// A frozen check file kept as text that differs in any way: how many lines differ, and the original lines
// that are gone. Lines only moved count as one change; a deleted final line break is one.
function compare(was: string, now: string): Omit<Change, 'file'> {
  const old = was.split('\n')
  const b = now.split('\n')
  const lost = missing(old, b)

  return { how: 'changed', n: Math.max(lost.length, missing(b, old).length, 1), lost: lost.filter(line => line.trim() !== '').slice(0, 5) }
}

/**
 * What became of each frozen check file (`was`) as it is now (`now`; a file
 * not in it is gone), and the new files among `names` that decide how the
 * checks run. A file unchanged is left out; so is a new check file: it is
 * free. Any difference in an existing check file is a change. `unread`: files that could not be read when armed (not new).
 */
export function classify(
  was: Record<string, Kept>,
  now: Record<string, Kept>,
  names: readonly string[],
  unread: readonly string[] = [],
): Change[] {
  const out: Change[] = []

  for (const [file, before] of Object.entries(was)) {
    const after = now[file]

    if (after === undefined) {
      // Still there but unreadable: it cannot be compared, and that is said elsewhere (`unread`).
      if (!unread.includes(file)) out.push({ file, how: decidesHowChecksRun(file) ? 'config' : 'gone' })
    } else if ('text' in before && 'text' in after ? before.text === after.text : hashOf(before) === hashOf(after)) {
      continue
    } else if (decidesHowChecksRun(file)) {
      out.push({ file, how: 'config' })
    } else if ('text' in before && 'text' in after) {
      out.push({ file, ...compare(before.text, after.text) })
    } else {
      out.push({ file, how: 'changed' })
    }
  }

  for (const file of names) {
    if (file in was || unread.includes(file)) continue

    const after = now[file]

    if (decidesHowChecksRun(file)) out.push({ file, how: 'config' })
    // A new check file is free, unless it makes the runner skip every other check.
    else if (after !== undefined && 'text' in after && RUNS_ONLY.test(after.text)) out.push({ file, how: 'only' })
  }

  return out
}
