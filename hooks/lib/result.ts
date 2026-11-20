// What the person is shown: one of three results, in at most three lines, and
// the one status line. Plain functions; the lines come from terms.ts `rule`.
import type { Result, Ruling, RulingLine } from '../../types'
import { isKept, isLie, namesBreach } from './terms'
import { isChangedAfter, isElsewhere, isExtra, isFailingRun, isNoFoul, isNoRun, isNotAlone, isNotWhole, isOldFailure } from './words'

const CHECKED = '✓ checked'
const PASSED = 'The checks passed after the last change. No existing check file was changed.'
const NO_NEW_CHECK = 'The AI added no new check for this change.'
const DISTRUST = '✗ don\'t trust "done"'
const UNCHECKED = '? not checked'
const NOT_RUN = 'The full check was not run after the last change.'
const NO_CHECKS = 'This project has no checks yet.'
const FAILS = 'The checks fail.'
const SAID = 'The AI said so itself.'
const NOT_SAID = 'The AI did not say so.'

/** Before any result: what Lie Eater does, in one line. */
export const INTRO = 'When the AI says "done", Lie Eater checks the proof: the checks must pass, and none may be removed or switched off.'

// The end of a line that names one file of several: "… and 2 more files."
const andMore = (more: number): string => (more === 0 ? '.' : ` and ${more} more ${more === 1 ? 'file' : 'files'}.`)

// A breach, in the person's words: what happened and where.
function breachLine(l: RulingLine, more: number): string {
  const file = l.file ?? ''

  if (l.term === 'config') return `The AI changed how the checks run: ${file}${andMore(more)}`
  if (l.term === 'gone') return `The AI moved or deleted the check file ${file}${andMore(more)}`
  if (l.term === 'only') return `The new check file ${file} runs only some of the checks (\`.only\`)${andMore(more)}`
  if (l.term === 'changed') {
    const what = l.n === undefined ? 'the check file' : `${l.n === 1 ? '1 line' : `${l.n} lines`} in the check file`

    return `The AI changed ${what} ${file}${andMore(more)}`
  }

  return FAILS
}

// A line not kept that shows no breach: why "done" cannot be checked.
function reasonLine(l: RulingLine): string {
  if (isOldFailure(l)) return 'The checks were already failing before the AI started.'
  if (isNotAlone(l)) return 'The check ran inside a longer command, so its result cannot be trusted.'
  if (isExtra(l)) return 'The full check was run with extra options. Run it plain.'
  if (isChangedAfter(l)) return 'The project changed after the last full check.'
  if (isElsewhere(l)) return 'The full check ran in another folder.'
  if (isNotWhole(l)) return 'The project could not be read fully.'
  if (l.term === 'unread') return `Lie Eater could not read ${l.file ?? ''}.`

  return NOT_RUN
}

// The person's order of what to name first: the worst first, a failing run last.
const FIRST: readonly RulingLine['term'][] = ['config', 'gone', 'changed', 'only', 'verdict']

// The third green line: whether the AI added a check file for its work.
const addedLine = (added: readonly string[]): string =>
  added[0] === undefined ? NO_NEW_CHECK : `The AI added new checks: ${added[0]}${andMore(added.length - 1)}`

/**
 * The one place that decides what the person is shown after a `done` call.
 * All kept: checked, with whether new check files were added (`added`: see
 * frozen.ts `newChecks`; it says nothing on any other result). A changed check
 * file, or a failing run: don't trust "done", with whether the AI said so
 * (`named`) or hid a changed check (`isLie`; nothing more for a plain failing run).
 * Anything else (no full run for the files as they are, a run in a chain or
 * with extra options, an unread run, checks that already failed): not
 * checked. Never an accusation.
 */
export function resultOf(
  lines: readonly RulingLine[],
  named: string,
  worked: boolean,
  added: readonly string[],
): { result: Result; screen: string[]; added?: string[] } {
  if (isKept(lines)) {
    return { result: 'checked', screen: [CHECKED, PASSED, addedLine(added)], added: [...added] }
  }

  const open = lines.filter(l => !l.pass)
  const breaches = open.filter(l => !isNoFoul(l) && !isNoRun(l))

  if (breaches.length === 0) {
    return { result: 'unchecked', screen: [UNCHECKED, reasonLine(open[0] as RulingLine)] }
  }

  const first = [...breaches].sort((a, b) => FIRST.indexOf(a.term) - FIRST.indexOf(b.term))[0] as RulingLine
  const files = breaches.filter(l => l.term !== 'verdict').length
  // A plain failing run is no change to the checks: only a changed check is "not said".
  const hid = isLie(lines, worked, named) && !isFailingRun(first)
  const said = namesBreach(named) ? [SAID] : hid ? [NOT_SAID] : []

  return { result: 'distrust', screen: [DISTRUST, breachLine(first, Math.max(files - 1, 0)), ...said] }
}

export type Now = { status: string; screen: string[]; action?: 'repair' | 'check' | 'add' }

/**
 * The status line and the top of the pane, from the same view: whether a
 * watch is armed, the newest result of that watch, and whether anything
 * changed since the watch was armed (or armed again: see terms.ts `hasChanged`).
 */
export function nowOf(view: { armed: boolean; changed: boolean; last?: Pick<Ruling, 'result' | 'screen' | 'accepted' | 'added'> }): Now {
  const last = view.last?.accepted === true ? undefined : view.last

  if (!view.armed) return { status: 'Lie Eater ? no checks yet', screen: [UNCHECKED, NO_CHECKS], action: 'add' }
  if (last?.result === 'distrust') return { status: `Lie Eater ${DISTRUST}`, screen: last.screen, action: 'repair' }
  if (last?.result === 'unchecked') return { status: `Lie Eater ${UNCHECKED}`, screen: last.screen, action: 'check' }
  if (view.changed) return { status: `Lie Eater ${UNCHECKED}`, screen: [UNCHECKED, NOT_RUN], action: 'check' }
  if (last?.result === 'checked') return { status: `Lie Eater ${CHECKED}${(last.added ?? []).length === 0 ? ' · no new check' : ''}`, screen: last.screen }

  return { status: 'Lie Eater · watching', screen: [INTRO] }
}

export type Face = 'watching' | 'pleased' | 'alarmed' | 'hungry'

/**
 * Munch, the face of the result: one short line and a face, read off what the
 * person is shown (`nowOf`). Munch decides nothing: it only says the result
 * that plain code gave. "You lied" only where the AI hid a changed check
 * (`resultOf` writes "The AI did not say so." only when `isLie` holds and the
 * first breach is no plain failing run).
 */
export function munchOf(now: Pick<Now, 'screen' | 'action'>): { face: Face; says: string } {
  const [title, first, third] = now.screen

  if (now.action === 'add') return { face: 'hungry', says: 'No checks here. Nothing to bite.' }
  if (now.action === 'check') return { face: 'hungry', says: 'No proof. Still hungry.' }
  if (now.action === 'repair') {
    if (first === FAILS) return { face: 'alarmed', says: 'Still red. Not done.' }
    if (third === NOT_SAID) return { face: 'alarmed', says: 'You lied. I ate it.' }

    return { face: 'alarmed', says: third === SAID ? 'A test got bent. It owned up.' : 'A test got bent. Nobody said why.' }
  }
  if (title === CHECKED) return { face: 'pleased', says: third === NO_NEW_CHECK ? 'Green. Nothing new got tested.' : 'Green, and a new test to chew.' }

  return { face: 'watching', says: 'Nothing to eat yet.' }
}
