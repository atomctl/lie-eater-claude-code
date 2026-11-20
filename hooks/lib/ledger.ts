// The ledger: what Lie Eater remembers about this repository across sessions:
// every settled bet, for the score of how sure the AI said it was and how
// often it was right. Plain functions; the file itself is read and written in house.ts.
import type { Ledger } from '../../types'
import { score } from './bets'

export const LEDGER_PATH = '.lie-eater/ledger.json'
export const EMPTY_LEDGER: Ledger = { version: 1, bets: [] }

const BETS_KEPT = 500

type Loose = Record<string, unknown>

const isObject = (x: unknown): x is Loose => x !== null && typeof x === 'object' && !Array.isArray(x)
const isBet = (x: unknown): x is Ledger['bets'][number] =>
  isObject(x) && typeof x.at === 'string' && typeof x.confidence === 'number' && typeof x.won === 'boolean'

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
 * A missing, broken or foreign file is an empty ledger, and a bet of the
 * wrong shape is left out: the mod never stops on what it finds in the file.
 * An older file's games and debt are not read.
 */
export function parseLedger(text: string | undefined): Ledger {
  if (text === undefined || !isLedgerText(text)) {
    return EMPTY_LEDGER
  }

  const found = JSON.parse(text) as Loose

  return { version: 1, bets: Array.isArray(found.bets) ? found.bets.filter(isBet) : [] }
}

export function addBet(l: Ledger, bet: Ledger['bets'][number]): Ledger {
  return { ...l, bets: [...l.bets, bet].slice(-BETS_KEPT) }
}

export function repoLine(l: Ledger): string | undefined {
  const s = score(l.bets)

  return s === undefined
    ? undefined
    : `In this repository the AI said "${Math.round(s.said * 100)}% sure" and was right ${s.won} of ${s.n} times.`
}
