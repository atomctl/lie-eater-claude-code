// What the person is shown: one of three results, in at most three lines, and
// the one status line. Plain functions; the lines come from terms.ts `rule`.
import type { Result, Ruling, RulingLine } from '../../types'
import { isKept, isLie, namesBreach } from './terms'
import { isFailingRun, isNoFoul, isNoRun, isNotAlone, isOldFailure } from './words'

const CHECKED = ['✓ checked', 'The checks passed after the last change.', 'None was removed or switched off.']
const DISTRUST = '✗ don\'t trust "done"'
const UNCHECKED = '? not checked'
const NOT_RUN = 'The full check was not run after the last change.'
const NO_CHECKS = 'This project has no checks yet.'

/** Before any result: what Lie Eater does, in one line. */
export const INTRO = 'When the AI says "done", Lie Eater checks the proof: the checks must pass, and none may be removed or switched off.'

const checks = (n: number): string => (n === 1 ? '1 check' : `${n} checks`)

// A breach of the checks, in the person's words: what happened and where.
function breachLine(l: RulingLine): string {
  const file = l.file ?? ''
  const n = l.n ?? 1

  if (l.term === 'tests') return l.n === undefined ? `The AI deleted the check file ${file}.` : `The AI removed ${checks(n)} from ${file}.`
  if (l.term === 'asserts') return `The AI removed ${checks(n)} from ${file}.`
  if (l.term === 'skips') return `The AI switched off ${checks(n)} in ${file}.`

  return isFailingRun(l) ? 'The checks fail.' : 'The AI ran only a part of the checks.'
}

// A line not kept that shows no breach: why "done" cannot be checked.
function reasonLine(l: RulingLine): string {
  if (isOldFailure(l)) return 'The checks were already failing before the AI started.'
  if (isNotAlone(l)) return 'The check ran inside a longer command, so its result cannot be trusted.'

  return NOT_RUN
}

// The person's order of what to name first: the checks themselves, then a part run, then a failing run.
const FIRST: readonly RulingLine['term'][] = ['tests', 'asserts', 'skips', 'verdict']

/**
 * The one place that decides what the person is shown after a `done` call.
 * All kept: checked. A breach of the checks, a part run or a failing run:
 * don't trust "done", with whether the AI said so (`named`) or hid a weakened
 * check (`isLie`; nothing more for a plain failing run).
 * Anything else (no run for the code as it is, a run in a chain, an unread
 * run, checks that already failed): not checked. Never an accusation.
 */
export function resultOf(lines: readonly RulingLine[], named: string, worked: boolean): { result: Result; screen: string[] } {
  if (isKept(lines)) {
    return { result: 'checked', screen: [...CHECKED] }
  }

  const open = lines.filter(l => !l.pass && !l.soft)

  const breaches = open.filter(l => !isNoFoul(l) && !isNoRun(l))

  if (breaches.length === 0) {
    return { result: 'unchecked', screen: [UNCHECKED, reasonLine(open[0] as RulingLine)] }
  }

  const first = [...breaches].sort((a, b) => FIRST.indexOf(a.term) - FIRST.indexOf(b.term))[0] as RulingLine
  // A plain failing run is no change to the checks: only a weakened check is "not said".
  const hid = isLie(lines, worked, named) && !isFailingRun(first)
  const said = namesBreach(named) ? ['The AI said so itself.'] : hid ? ['The AI did not say so.'] : []

  return { result: 'distrust', screen: [DISTRUST, breachLine(first), ...said] }
}

export type Now = { status: string; screen: string[]; action?: 'repair' | 'check' | 'add' }

/**
 * The status line and the top of the pane, from the same view: whether a
 * watch is armed, the newest result of that watch, and whether code changed
 * since the watch was armed (or armed again after a green result).
 */
export function nowOf(view: { armed: boolean; changed: boolean; last?: Pick<Ruling, 'result' | 'screen' | 'accepted'> }): Now {
  const last = view.last?.accepted === true ? undefined : view.last

  if (!view.armed) return { status: 'Lie Eater ? no checks yet', screen: [UNCHECKED, NO_CHECKS], action: 'add' }
  if (last?.result === 'distrust') return { status: `Lie Eater ${DISTRUST}`, screen: last.screen, action: 'repair' }
  if (last?.result === 'unchecked') return { status: `Lie Eater ${UNCHECKED}`, screen: last.screen, action: 'check' }
  if (view.changed) return { status: `Lie Eater ${UNCHECKED}`, screen: [UNCHECKED, NOT_RUN], action: 'check' }
  if (last?.result === 'checked') return { status: 'Lie Eater ✓ checked', screen: last.screen }

  return { status: 'Lie Eater · watching', screen: [INTRO] }
}
