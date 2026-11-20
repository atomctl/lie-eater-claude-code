// Reading a shell command: what kind it is, and whether it changes files.
// Plain functions; nothing here talks to the engine.
import type { CommandKind } from '../../types'

/** The command with every quoted text taken out: words inside quotes are not commands. */
export const unquoted = (command: string): string => command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, 'Q')

// What may stand in front of the real command: variables, runners, `python -m`.
const WRAPPERS =
  /^(?:[A-Za-z_]\w*=\S*\s+|(?:npx|bunx|sudo|time|exec)\s+|(?:pnpm|yarn)\s+(?:exec|dlx)\s+|(?:uv|poetry|pipenv|hatch|pdm)\s+run\s+|python3?\s+-m\s+)+/

// Each pattern is tried at the start of each part of a chained command.
// The order is the priority when one command chains several kinds.
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

/** The parts of a chained command, each without what stands in front of it. */
const parts = (command: string): string[] =>
  unquoted(command)
    .split(/&&|\|\||[;|]/)
    .map(part => part.trim().replace(WRAPPERS, ''))

export function classifyCommand(command: string): CommandKind {
  const all = parts(command)

  return KINDS.find(([, pattern]) => all.some(part => pattern.test(part)))?.[0] ?? 'other'
}

/** One `|` that is not part of `||`: the shell then reports the last command only. */
export const hasPipe = (command: string): boolean => /(^|[^|])\|([^|]|$)/.test(unquoted(command))

const CODE_TARGET = /\.(py|[cm]?[jt]sx?|go|rs|rb|java|c|h|cpp|cs|php|kt|swift|sh|sql|ya?ml|toml)$/
const EDITS =
  /\bsed\s+(?:-\S+\s+)*-\w*i|\bperl\s+-\w*i|\bpatch\b|\bgit\s+(?:apply|checkout|restore|stash|reset|merge|rebase|pull|cherry-pick|revert)\b|(?:^|[\s;&|])(?:mv|cp)\s|--write\b|--fix\b|\bfind\b.*-delete\b/

/** A shell command that changes files, so a test run before it is stale. */
export function isShellEdit(command: string): boolean {
  const bare = unquoted(command)

  if (EDITS.test(bare)) {
    return true
  }

  // A redirect or a `tee` into a code file. Logs and /dev/null do not count.
  const targets = [...bare.matchAll(/(?<![0-9&])>>?\s*([^\s&|;]+)|\btee\s+(?:-a\s+)?([^\s&|;]+)/g)].map(
    m => m[1] ?? m[2] ?? '',
  )

  return targets.some(target => !target.startsWith('/dev/') && CODE_TARGET.test(target))
}
