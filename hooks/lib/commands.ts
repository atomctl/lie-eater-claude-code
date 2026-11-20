// Reading a shell command: what kind it is, whether it changes files, and
// whether its output can be trusted. Plain functions; nothing here talks to the engine.
import type { CommandKind } from '../../types'

/** The command with every quoted text taken out: words inside quotes are not commands. */
export const unquoted = (command: string): string => command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, 'Q')

/** What may stand in front of the real command: variables, runners, `python -m`, `timeout 600`. */
export const WRAPPERS =
  /^(?:[A-Za-z_]\w*=\S*\s+|(?:npx|bunx|sudo|time|exec)\s+|timeout\s+\S+\s+|(?:pnpm|yarn)\s+(?:exec|dlx)\s+|(?:uv|poetry|pipenv|hatch|pdm)\s+run\s+|python3?\s+-m\s+)+/

/** A file that is source code. A changelog, docs, config and data are not. */
export const CODE_FILE = /\.(py|[cm]?[jt]sx?|go|rs|rb|java|kt|swift|c|h|cc|cpp|hpp|cs|php|scala|sh|sql|vue|svelte)$/

// Each pattern is tried at the start of each command of a chain.
// The order is the priority when one chain holds several kinds.
const KINDS: [CommandKind, RegExp][] = [
  [
    'test',
    /^(?:(?:pytest|py\.test|jest|vitest|mocha|ava|tox|nox|rspec|phpunit|ctest|unittest)\b|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|(?:go|cargo|deno|dotnet|mvn|(?:\.\/)?gradle\w*)\s+test\b|node\s+--test\b|make\s+(?:test|check)\b|claude\s+plugin\s+test\b)/,
  ],
  [
    'build',
    /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b|tsc\b|(?:cargo|go|docker|next|vite|(?:\.\/)?gradle\w*)\s+build\b|mvn\s+(?:package|compile)\b|make(?:\s+all)?$)/,
  ],
  ['lint', /^(?:(?:eslint|ruff|flake8|pylint|mypy|biome|golangci-lint)\b|cargo\s+clippy\b|prettier\s+--check\b)/],
  ['git', /^git\s/],
  [
    'install',
    /^(?:(?:npm|pnpm|yarn|bun)\s+(?:install|i|ci|add)\b|pip3?\s+install\b|uv\s+(?:add|sync|pip)\b|cargo\s+add\b|brew\s+install\b|apt(?:-get)?\s+install\b)/,
  ],
]

/** The commands of a chain (`a && b; c | d`), quotes taken out. */
export const chain = (command: string): string[] =>
  unquoted(command)
    .split(/&&|\|\||[;|]/)
    .map(part => part.replace(/\s+/g, ' ').trim())
    .filter(part => part !== '')

// The commands of a chain, each without what stands in front of it.
const steps = (command: string): string[] => chain(command).map(part => part.replace(WRAPPERS, ''))

const kindOf = (step: string): CommandKind | undefined => KINDS.find(([, pattern]) => pattern.test(step))?.[0]

export function classifyCommand(command: string): CommandKind {
  const all = steps(command)

  return KINDS.find(([, pattern]) => all.some(step => pattern.test(step)))?.[0] ?? 'other'
}

/**
 * The shell does not report this command's own exit code: a pipe, `|| …`, or
 * `; next` puts another command's result in its place. Such a run is judged by
 * the counts in its output.
 */
export const isMasked = (command: string): boolean => /\||;\s*\S/.test(unquoted(command))

// Text that looks like a test count. A real test command does not hold it.
const COUNT_WORDS = /\b\d+\s+(passed|failed|passing|failing)\b|\b(pass|fail)\s+\d+\b|\bTests:\s/i
// Commands that may stand beside a test run without adding to its output or cutting counts out of it.
const HARMLESS = /^(?:cd\s|tail\b|head\b|tee\b|echo\b|printf\b|ls\b|pwd$|date$|true$|:$|sleep\s|exit\b)/

/**
 * When the exit code is hidden, the counts decide. But only if they are the
 * run's own: not when the command prints count-like text itself
 * (`; echo 0 failed`), and not when another command of the chain could add
 * lines or filter them out (`cat old.txt`, `grep -v FAIL`).
 */
export function countsAreItsOwn(command: string): boolean {
  if (COUNT_WORDS.test(command)) {
    return false
  }

  return steps(command).every(step => {
    const kind = kindOf(step)

    return kind === 'test' || kind === 'build' || HARMLESS.test(step)
  })
}

// Does this git command change files in the working tree?
function gitChangesFiles(step: string): boolean {
  const [, sub = '', rest = ''] = step.match(/^git\s+(\S+)\s*(.*)$/) ?? []

  switch (sub) {
    case 'checkout':
      return !/^-[bB]\b/.test(rest) // `-b name` only makes a branch
    case 'switch':
      return !/^-[cC]\b/.test(rest)
    case 'restore':
      return !/--staged\b/.test(rest)
    case 'stash':
      return !/^(list|show|drop)\b/.test(rest)
    case 'reset':
      return /--hard\b/.test(rest)
    case 'merge':
    case 'rebase':
    case 'pull':
    case 'cherry-pick':
    case 'revert':
    case 'apply':
    case 'am':
      return true
    default:
      return false // add, commit, push, status, log, diff, branch, tag …
  }
}

const namesCode = (step: string): boolean => step.split(' ').some(word => CODE_FILE.test(word))

/** A shell command that changes code, so a test run before it is stale. */
export function isShellEdit(command: string): boolean {
  const changes = steps(command).some(
    step =>
      gitChangesFiles(step) ||
      /^patch\b|--write\b|--fix\b|^find\b.*-delete\b/.test(step) ||
      (/^(?:sed\s+(?:-\S+\s+)*-\w*i|perl\s+-\w*i|mv\s|cp\s)/.test(step) && namesCode(step)),
  )

  if (changes) {
    return true
  }

  // A redirect or a `tee` into a code file. Logs and /dev/null do not count.
  const targets = [...unquoted(command).matchAll(/(?<![0-9&])>>?\s*([^\s&|;]+)|\btee\s+(?:-a\s+)?([^\s&|;]+)/g)].map(
    m => m[1] ?? m[2] ?? '',
  )

  return targets.some(target => CODE_FILE.test(target))
}
