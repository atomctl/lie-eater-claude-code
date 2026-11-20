// The referee's presence when no game is played: the flag (where the work
// stands), his number for this repository, and his face. Plain functions.
import type { Terms } from '../../types'

export type Flag = { color: 'green' | 'yellow' | 'red'; text: string }

/**
 * Where the work stands, read from the watch. It states; it never accuses.
 * Undefined while there is nothing to say: no test run and no code change yet.
 */
export function flagOf(watch: Terms | null): Flag | undefined {
  if (watch === null) {
    return undefined
  }

  const run = watch.verdictRun

  if (run === undefined) {
    return watch.lastCodeEdit > watch.startRecord
      ? { color: 'yellow', text: 'code changed, tests not run yet' }
      : undefined
  }

  if (run.record < watch.lastCodeEdit) return { color: 'yellow', text: 'code changed since the last test run' }
  if (run.state === 'unknown') return { color: 'yellow', text: 'the last test run gave no clear result' }
  if (run.state === 'failed') return { color: 'red', text: 'tests fail' }

  return { color: 'green', text: 'tests passed, nothing changed since' }
}

/** The first remote of a git config: the same text on every clone of the repository. */
export function gitRemote(config: string | undefined): string | undefined {
  return config?.match(/^\s*url\s*=\s*(\S+)/m)?.[1]
}

/**
 * Each repository has its own referee: a number from 1 to 999, made from the
 * repository's remote (or the folder's name), so a whole team gets the same one.
 */
export function refereeNumber(seed: string): number | undefined {
  if (seed === '') {
    return undefined
  }

  // FNV-1a, 32 bit: small, and the same everywhere.
  let hash = 0x811c9dc5
  for (let i = 0; i < seed.length; i += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 0x01000193) >>> 0
  }

  return (hash % 999) + 1
}

export type Mood = 'watching' | 'attentive' | 'stern' | 'pleased'

export const FACE: Record<Mood, string> = {
  watching: '(o_o)',
  attentive: '(O_O)',
  stern: '(-_-)',
  pleased: '(^_^)',
}

/** The referee is neutral, but he is not blind: his face follows what he sees. */
export function moodOf(seen: { hasOpenBet: boolean; isBroken: boolean; isKept: boolean; flag?: Flag; debt: number }): Mood {
  if (seen.hasOpenBet) return 'attentive'
  if (seen.isBroken || seen.flag?.color === 'red' || seen.debt > 0) return 'stern'
  if (seen.isKept || seen.flag?.color === 'green') return 'pleased'

  return 'watching'
}

/** The one pinned line under the prompt. */
export function statusLine(view: {
  mood: Mood
  number?: number
  present: boolean
  bets?: { won: number; n: number }
  flag?: Flag
  debt: number
}): string {
  return [
    `${FACE[view.mood]} Referee${view.number === undefined ? '' : ` No. ${view.number}`}${view.present ? ' present' : ''}`,
    ...(view.present && view.bets !== undefined ? [`bets ${view.bets.won}/${view.bets.n}`] : []),
    ...(view.flag === undefined ? [] : [`⚑ ${view.flag.color}: ${view.flag.text}`]),
    ...(view.debt === 0 ? [] : [`debt ${view.debt}`]),
  ].join(' · ')
}
