// Receipts: the results of one watch written down, so that a person, a script
// or a CI job can read them later. Format `lie-eater/receipts`, version 4.
// Plain functions.
import type { Bet, Ledger, Ruling, Terms } from '../../types'
import { betText, score } from './bets'
import { masked } from './commands'
import { repoLine } from './ledger'
import { detailLines } from './words'

export const RECEIPTS_JSON = '.lie-eater/receipts.json'
export const RECEIPTS_MD = '.lie-eater/receipts.md'

export type Receipt = {
  format: 'lie-eater/receipts'
  version: 4
  createdAt: string
  check: { command: string; since: string }
  results: Omit<Ruling, 'lost' | 'print'>[]
  bets: Bet[]
  score: NonNullable<ReturnType<typeof score>> | null
  unbet: number
  repository: { line: string | null }
}

const settled = (bets: readonly Bet[]) =>
  bets.filter(b => b.state === 'won' || b.state === 'lost').map(b => ({ confidence: b.confidence, won: b.state === 'won' }))

/**
 * The receipt of one watch: only its own results, and the bets placed since
 * it was armed. No raw command line is kept (see commands.ts `masked`), and
 * no text of a check file: the lines that are gone stay in the pane.
 */
export function buildReceipt(input: {
  watch: Terms
  rulings: readonly Ruling[]
  bets: readonly Bet[]
  unbet: number
  ledger: Ledger
  createdAt: string
}): Receipt {
  const bets = input.bets.filter(b => b.at >= input.watch.at)

  return {
    format: 'lie-eater/receipts',
    version: 4,
    createdAt: input.createdAt,
    check: { command: masked(input.watch.verdict), since: new Date(input.watch.at).toISOString() },
    results: input.rulings.filter(r => r.termsId === input.watch.id).map(({ lost: _lost, print: _print, ...r }) => r),
    bets,
    score: score(settled(bets)) ?? null,
    unbet: input.unbet,
    repository: { line: repoLine(input.ledger) ?? null },
  }
}

const BET_WORD: Record<Bet['state'], string> = { open: 'OPEN', won: 'WON', lost: 'LOST', void: 'VOID' }

export function receiptToMarkdown(r: Receipt): string {
  const results = r.results.flatMap(x => [
    `### Result ${x.id} (turn ${x.turn})${x.accepted === true ? ', accepted by the person' : ''}`,
    '',
    '```',
    ...x.screen,
    '',
    'Details:',
    ...detailLines(x.lines),
    '```',
    '',
  ])
  const bets = r.bets.map(b => `- #${b.id} ${betText(b)}: ${BET_WORD[b.state]}${b.line === undefined ? '' : ` · ${b.line}`}`)

  return [
    '# Lie Eater receipts',
    '',
    `Full check: \`${r.check.command}\`, watched since ${r.check.since}. Written ${r.createdAt}.`,
    '',
    '## Results',
    '',
    ...(results.length === 0 ? ['No result yet.', ''] : results),
    '## Bets',
    '',
    ...(bets.length === 0 ? ['No bet was placed.'] : bets),
    '',
    ...(r.score === null
      ? []
      : [`The AI said "${Math.round(r.score.said * 100)}% sure". It was right ${r.score.won} of ${r.score.n} times.`]),
    `Runs without a bet: ${r.unbet}`,
    '',
    ...(r.repository.line === null ? [] : ['## This repository', '', r.repository.line, '']),
  ].join('\n')
}
