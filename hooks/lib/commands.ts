// Reading a shell command: what kind it is, whether it changes files, and
// whether its output can be trusted. Plain functions; nothing here talks to the engine.
import type { CommandKind } from '../../types'

// The body of a heredoc (`<<EOF … EOF`) is text, not commands.
const HEREDOC = /(<<-?\s*\\?(['"]?)(\w+)\2[^\n]*)\n(?:[\s\S]*?\n)?[ \t]*\3[ \t]*(?=\n|$)/g
// A quoted text, or a comment: a `#` that starts a word, to the end of its line.
const QUOTED_OR_COMMENT = /'[^']*'|"(?:[^"\\]|\\.)*"|(^|\s)#[^\n]*/gm

// The command as the shell reads it, on one line: no heredoc body and no
// comment; a line that ends in `\` goes on in the next; every other new line
// starts a new command, like `;`. `quoted` says what becomes of a quoted text.
const flat = (command: string, quoted: (text: string) => string): string =>
  command
    .replace(HEREDOC, '$1')
    .replace(QUOTED_OR_COMMENT, (found: string, space?: string) => (space === undefined ? quoted(found) : space))
    .replace(/\\\n/g, ' ')
    .replace(/(&&|\|\||\|&?)\s*\n\s*/g, '$1 ')
    .trim()
    .replace(/\s*\n\s*/g, '; ')

/** The command on one line, with every quoted text taken out: words inside quotes are not commands. */
export const unquoted = (command: string): string => flat(command, () => 'Q')

/** The command on one line, with its quoted texts as they were typed. */
export const oneLine = (command: string): string => flat(command, text => text)

/**
 * What may stand in front of the real command: variables, runners
 * (`npx`, `yarn jest`, `bundle exec`, `python -m`, `timeout 600`), and the
 * folder of a program that is named by its path (`.venv/bin/pytest`).
 */
export const WRAPPERS =
  /^(?:[A-Za-z_]\w*=\S*\s+|(?:npx|bunx|sudo|time|exec|env|command)\s+|timeout\s+\S+\s+|(?:pnpm|yarn)\s+(?:exec|dlx)\s+|(?:pnpm|yarn|bun)\s+(?=(?:jest|vitest|mocha|ava|tsc|eslint)\b)|(?:uv|poetry|pipenv|hatch|pdm)\s+run\s+|bundle\s+exec\s+|python[\d.]*\s+-m\s+|\S*\/(?=[\w.@-]+(?:\s|$)))+/

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

// One command of a chain as it stands by itself: outside its `( … )` or `{ … }` group.
const alone = (part: string): string =>
  part
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[({]\s*/, '')
    .replace(/\s*[)}]$/, '')

/** The commands of a chain (`a && b; c | d`, or one on each line), quotes taken out. */
export const chain = (command: string): string[] =>
  unquoted(command)
    .split(/&&|\|\||\|&?|;/)
    .map(alone)
    .filter(part => part !== '')

/**
 * One command by itself: no pipe, no `;`, `&&` or `||`, no second line, no
 * group or subshell, not sent to the background. Its exit code is its own.
 * Where its output goes (`2>&1`, `> out.txt`) does not matter.
 */
export const isAlone = (command: string): boolean =>
  chain(command).length === 1 && !/[(){}]|(?<![>&])&(?![>&])/.test(unquoted(command))

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

// Words of a test summary. A real test command does not hold them; `echo "12 passed"` does.
const SUMMARY_WORDS = /\b(passed|failed|passing|failing)\b|\bTests:/i
// After a pipe, only these keep the run's own lines as they are (they cut by position, or pass through)...
const KEEPS_LINES = /^(?:tail|head|tee|cat)\b/
// ...unless they are told to keep none.
const KEEPS_NONE = /^(?:tail|head)\b.*\s-(?:[nc]\s*)?0\b/
// Output that goes to a file: `> f`, `>> f`, `1> f`, `&> f` (not `2> f`, not `2>&1`).
const TO_FILE = /(?:^|[^0-9&>])[1&]?>>?\s*[^&\s>]/
// Beside the run, these run code of their own: their output could be anything...
const RUNS_CODE = /^(?:(?:python[\d.]*|node|ruby|perl|bash|sh|zsh|xargs|printf|curl|wget)\b|(?:source|\.)\s)/
// ...but a sourced environment file only sets up the shell (`source .venv/bin/activate`): it prints nothing.
const SETS_UP = /^(?:source|\.)\s+\S*(?:activate|\.env(?:\.\w+)?|\.envrc|env\.sh|nvm\.sh|conda\.sh|\.(?:ba|z)shrc|\.(?:bash_)?profile)$/
// Beside the run, these print the text of files: a summary in the output may be theirs.
const PRINTS_FILES = /^(?:cat|less|more|bat|sed|awk|grep|rg|jq|head|tail|nl|git\s+(?:diff|show|log))\b/

// The chain as pipelines, each a list of commands: `a | b && c` is [[a, b], [c]].
const pipelines = (command: string): string[][] =>
  unquoted(command)
    .split(/&&|\|\||;/)
    .map(line => line.split(/\|&?/).map(step => alone(step).replace(WRAPPERS, '')).filter(step => step !== ''))
    .filter(line => line.length > 0)

const isRun = (step: string): boolean => kindOf(step) === 'test' || kindOf(step) === 'build'

/**
 * When the exit code is hidden, the counts in the output decide. But only if
 * the run's own output reaches the referee whole:
 *  - the command holds no summary words itself (`; echo "12 passed"`);
 *  - the run's output is not sent to a file;
 *  - from the run, a pipe leads only to `tail`, `head`, `tee` or `cat`, and not to `tail -0`;
 *  - no command beside the run runs code of its own (a script can print anything);
 *    sourcing an environment file is setup, not such code.
 * Commands that read beside the run (`cat cart.py`, `git status`, `ls`) are
 * fine: an honest agent chains them all the time. See `sharesOutput` for the
 * one case where their text matters.
 */
export function countsAreItsOwn(command: string): boolean {
  if (SUMMARY_WORDS.test(command)) {
    return false
  }

  return pipelines(command).every(line => {
    const at = line.findIndex(isRun)

    if (at === -1) {
      return !line.some(step => RUNS_CODE.test(step) && !SETS_UP.test(step))
    }

    const own = line.slice(at)

    return !own.some(step => TO_FILE.test(step)) && own.slice(1).every(step => KEEPS_LINES.test(step) && !KEEPS_NONE.test(step))
  })
}

/**
 * Does another command stand in front of the first test or build run
 * (`cd api && npm test`)? When such a chain fails and shows no counts, the
 * command in front may be what failed, and the run never started.
 */
export function runsAfterAnother(command: string): boolean {
  return pipelines(command).findIndex(line => line.some(isRun)) > 0
}

/** Does another command stand behind the run (`npm test && git commit`)? Then a failed chain may be its failure. */
export function runsBeforeAnother(command: string): boolean {
  const lines = pipelines(command)
  const at = lines.findIndex(line => line.some(isRun))

  return at !== -1 && at < lines.length - 1
}

/**
 * Does a command beside the run print the text of files? Such a file can hold
 * a summary line of its own (a README with sample output, the tests of a test
 * tool). The counts are then the run's only when the output holds one summary.
 */
export function sharesOutput(command: string): boolean {
  return pipelines(command).some(line => !line.some(isRun) && line.some(step => PRINTS_FILES.test(step)))
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
