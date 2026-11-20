// The ledger: what the house remembers about this repository across sessions.
// Bets (how often the AI was right), games (kept or broken) and the Debt.
// Plain functions; the file itself is read and written in house.ts.
import type { DebtEntry, Ledger, TermId, Terms } from '../../types'
import { score } from './bets'

export const LEDGER_PATH = '.lie-eater/ledger.json'
export const EMPTY_LEDGER: Ledger = { version: 1, bets: [], games: [], debt: [] }

const BETS_KEPT = 500
const GAMES_KEPT = 200

/** A missing, broken or foreign file is an empty ledger: the mod never stops on it. */
export function parseLedger(text: string | undefined): Ledger {
  try {
    const found = JSON.parse(text ?? '') as Partial<Ledger> | null

    if (found === null || found.version !== 1) {
      return EMPTY_LEDGER
    }

    return {
      version: 1,
      bets: Array.isArray(found.bets) ? found.bets : [],
      games: Array.isArray(found.games) ? found.games : [],
      debt: Array.isArray(found.debt) ? found.debt : [],
    }
  } catch {
    return EMPTY_LEDGER
  }
}

export function addBet(l: Ledger, bet: Ledger['bets'][number]): Ledger {
  return { ...l, bets: [...l.bets, bet].slice(-BETS_KEPT) }
}

/** One debt per game. A second call for the same game only updates what is broken. */
export function addDebt(l: Ledger, game: Terms, failed: TermId[], at: string): Ledger {
  const has = l.debt.find(d => d.termsAt === game.at)

  if (has !== undefined) {
    return has.cleared === undefined
      ? { ...l, debt: l.debt.map(d => (d === has ? { ...d, failed } : d)) }
      : l
  }

  const entry: DebtEntry = {
    id: Math.max(0, ...l.debt.map(d => d.id)) + 1,
    at,
    termsAt: game.at,
    verdict: game.verdict,
    failed,
    text: `game of ${at.slice(0, 10)}: ${game.verdict}`,
  }

  return { ...l, debt: [...l.debt, entry] }
}

const clear = (l: Ledger, at: string, by: 'proof' | 'person', which: (d: DebtEntry) => boolean): Ledger => ({
  ...l,
  debt: l.debt.map(d => (d.cleared === undefined && which(d) ? { ...d, cleared: { at, by } } : d)),
})

/** Only proof repays: a game that ends with the rules kept clears every open debt. */
export const repay = (l: Ledger, at: string): Ledger => clear(l, at, 'proof', () => true)

/** The person overrules one game. */
export const overrule = (l: Ledger, termsAt: number, at: string): Ledger =>
  clear(l, at, 'person', d => d.termsAt === termsAt)

export const openDebt = (l: Ledger): DebtEntry[] => l.debt.filter(d => d.cleared === undefined)

export function repoLine(l: Ledger): string | undefined {
  const s = score(l.bets)

  return s === undefined
    ? undefined
    : `In this repository the AI said "${Math.round(s.said * 100)}% sure" and was right ${s.won} of ${s.n} times.`
}

export function addGame(l: Ledger, game: Ledger['games'][number]): Ledger {
  return { ...l, games: [...l.games.filter(g => g.termsAt !== game.termsAt), game].slice(-GAMES_KEPT) }
}

export const dropGame = (l: Ledger, termsAt: number): Ledger => ({
  ...l,
  games: l.games.filter(g => g.termsAt !== termsAt),
})

/** How many games in a row, up to now, ended with the rules kept. */
export function streak(l: Ledger): number {
  const firstBroken = [...l.games].reverse().findIndex(g => !g.kept)

  return firstBroken === -1 ? l.games.length : firstBroken
}
