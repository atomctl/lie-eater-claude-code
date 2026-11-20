// The ledger: what the house remembers about this repository across sessions.
// Bets (how often the AI was right), games (kept or broken) and the Debt.
// Plain functions; the file itself is read and written in house.ts.
import type { DebtEntry, Ledger, TermId, Terms } from '../../types'
import { score } from './bets'

export const LEDGER_PATH = '.lie-eater/ledger.json'
export const EMPTY_LEDGER: Ledger = { version: 1, bets: [], games: [], debt: [] }

const BETS_KEPT = 500
const GAMES_KEPT = 200

type Loose = Record<string, unknown>

const isObject = (x: unknown): x is Loose => x !== null && typeof x === 'object' && !Array.isArray(x)
const isBet = (x: unknown): x is Ledger['bets'][number] =>
  isObject(x) && typeof x.at === 'string' && typeof x.confidence === 'number' && typeof x.won === 'boolean'
const isGame = (x: unknown): x is Ledger['games'][number] =>
  isObject(x) && typeof x.at === 'string' && typeof x.termsAt === 'number' && typeof x.kept === 'boolean'
const isDebt = (x: unknown): x is DebtEntry =>
  isObject(x) &&
  typeof x.id === 'number' &&
  typeof x.at === 'string' &&
  typeof x.termsAt === 'number' &&
  typeof x.verdict === 'string' &&
  typeof x.text === 'string' &&
  Array.isArray(x.failed)
const list = <T>(x: unknown, is: (item: unknown) => item is T): T[] => (Array.isArray(x) ? x.filter(is) : [])

/** Is this text a ledger of this version? If not, the file is the person's and must not be written over. */
export function isLedgerText(text: string): boolean {
  try {
    const found: unknown = JSON.parse(text)

    return isObject(found) && found.version === 1
  } catch {
    return false
  }
}

/**
 * A missing, broken or foreign file is an empty ledger, and an entry of the
 * wrong shape is left out: the mod never stops on what it finds in the file.
 */
export function parseLedger(text: string | undefined): Ledger {
  if (text === undefined || !isLedgerText(text)) {
    return EMPTY_LEDGER
  }

  const found = JSON.parse(text) as Loose

  return { version: 1, bets: list(found.bets, isBet), games: list(found.games, isGame), debt: list(found.debt, isDebt) }
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

/** `/overrule debt`: the person clears every open debt. */
export const forgive = (l: Ledger, at: string): Ledger => clear(l, at, 'person', () => true)

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
