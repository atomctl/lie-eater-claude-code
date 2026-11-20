// Receipts: one game written down so that a person, a script or a CI job can
// read it later. Format `lie-eater/receipts`, version 1. Plain functions.
import type { Bet, Ledger, Ruling, Terms } from '../../types'
import { betText, score } from './bets'
import { openDebt, repoLine } from './ledger'
import { rulingText, termsText } from './words'

export const RECEIPTS_JSON = '.lie-eater/receipts.json'
export const RECEIPTS_MD = '.lie-eater/receipts.md'

export type Receipt = {
  format: 'lie-eater/receipts'
  version: 1
  createdAt: string
  terms: { verdict: string; lockedAt: string; lines: string[] }
  rulings: Ruling[]
  bets: Bet[]
  score: NonNullable<ReturnType<typeof score>> | null
  unbet: number
  repository: { line: string | null; openDebt: number }
}

const settled = (bets: readonly Bet[]) =>
  bets.filter(b => b.state === 'won' || b.state === 'lost').map(b => ({ confidence: b.confidence, won: b.state === 'won' }))

/** The receipt of one game: only its own rulings and the bets placed since it was locked. */
export function buildReceipt(input: {
  terms: Terms
  rulings: readonly Ruling[]
  bets: readonly Bet[]
  unbet: number
  ledger: Ledger
  createdAt: string
}): Receipt {
  const bets = input.bets.filter(b => b.at >= input.terms.at)

  return {
    format: 'lie-eater/receipts',
    version: 1,
    createdAt: input.createdAt,
    terms: {
      verdict: input.terms.verdict,
      lockedAt: new Date(input.terms.at).toISOString(),
      lines: termsText(input.terms),
    },
    rulings: input.rulings.filter(r => r.termsId === input.terms.id),
    bets,
    score: score(settled(bets)) ?? null,
    unbet: input.unbet,
    repository: { line: repoLine(input.ledger) ?? null, openDebt: openDebt(input.ledger).length },
  }
}

const BET_WORD: Record<Bet['state'], string> = { open: 'OPEN', won: 'WON', lost: 'LOST', void: 'VOID' }

export function receiptToMarkdown(r: Receipt): string {
  const rulings = r.rulings.flatMap(x => [
    `### Ruling ${x.id} (turn ${x.turn})${x.overruled === true ? ', overruled by the person' : ''}`,
    '',
    '```',
    ...rulingText(x.lines, { final: x.final, ...(x.debt === undefined ? {} : { debt: x.debt }) }),
    '```',
    '',
  ])
  const bets = r.bets.map(b => `- #${b.id} ${betText(b)}: ${BET_WORD[b.state]}${b.line === undefined ? '' : ` · ${b.line}`}`)

  return [
    '# Lie Eater receipts',
    '',
    `Game locked ${r.terms.lockedAt}. Written ${r.createdAt}.`,
    '',
    '## Rules',
    '',
    ...r.terms.lines,
    '',
    '## Rulings',
    '',
    ...(rulings.length === 0 ? ['No ruling was made.', ''] : rulings),
    '## Bets',
    '',
    ...(bets.length === 0 ? ['No bet was placed.'] : bets),
    '',
    ...(r.score === null
      ? []
      : [`The AI said "${Math.round(r.score.said * 100)}% sure". It was right ${r.score.won} of ${r.score.n} times.`]),
    `Runs without a bet: ${r.unbet}`,
    '',
    '## This repository',
    '',
    ...(r.repository.line === null ? [] : [r.repository.line]),
    `Open debt: ${r.repository.openDebt}`,
    '',
  ].join('\n')
}
