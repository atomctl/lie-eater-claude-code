// The Details block of the pane, as plain lines: the evidence for an expert.
// register.tsx draws them, dim, under the result.
import type { Bet, Ledger, Ruling, Terms, ToolRecord } from '../../types'
import { betText, score, youLine } from './bets'
import { repoLine } from './ledger'
import { detailLines } from './words'

const MARK: Record<ToolRecord['state'], string> = { clean: '✓', failed: '✗', unknown: '?' }
const RECORDS_SHOWN = 5
const BETS_SHOWN = 3

/** One line per record, the oldest first, each cut to the pane's width. */
function recordRows(records: readonly ToolRecord[], columns: number): string[] {
  return records.map(r => `#${r.id} ${r.kind} ${MARK[r.state]} ${r.target}`.trimEnd().slice(0, columns))
}

function recordHeader(records: readonly ToolRecord[]): string {
  const first = records[0]
  const last = records.at(-1)

  return first === undefined || last === undefined
    ? 'No tool calls yet.'
    : `Calls recorded: ${records.length} (#${first.id} to #${last.id})`
}

const BET_WORD: Record<Bet['state'], string> = { open: 'OPEN', won: 'WON', lost: 'LOST', void: 'VOID' }

/** The newest bets, two lines each: what was said, then how it ended. */
function betRows(bets: readonly Bet[]): string[] {
  return bets
    .slice(-BETS_SHOWN)
    .reverse()
    .flatMap(b => [
      `#${b.id} ${betText(b)}`,
      `    ${BET_WORD[b.state]}${b.line === undefined ? '' : ` · ${b.line}`}${b.state === 'open' && b.you !== undefined ? ` · you: it will ${b.you}` : ''}`,
    ])
}

/** The score in plain words, and the counts under it. */
function scoreLines(bets: readonly Bet[], unbet: number): string[] {
  const settled = bets.filter(b => b.state === 'won' || b.state === 'lost')
  const voids = bets.filter(b => b.state === 'void').length
  const s = score(settled.map(b => ({ confidence: b.confidence, won: b.state === 'won' })))
  const you = youLine(bets)

  if (s === undefined && voids === 0 && unbet === 0) {
    return []
  }

  const counts = `Bets: ${s?.won ?? 0} won, ${s?.lost ?? 0} lost${voids === 0 ? '' : `, ${voids} void`}`
  const noBet = unbet === 0 ? '' : ` · ${unbet} ${unbet === 1 ? 'run' : 'runs'} without a bet`

  return [
    ...(s === undefined ? [] : [`The AI said "${Math.round(s.said * 100)}% sure". It was right ${s.won} of ${s.n} times.`]),
    `${counts}${noBet}`,
    ...(you === undefined ? [] : [you]),
  ]
}

/**
 * Details, for an expert: the full check, the evidence of the newest result
 * (which run counted, the files and lines), the bets, the newest tool calls.
 * Every line is cut to the pane's width.
 */
export function detailRows(view: {
  watch: Terms | null
  last: Ruling | undefined
  records: readonly ToolRecord[]
  bets: readonly Bet[]
  unbet: number
  ledger: Ledger
  columns: number
}): string[] {
  const repo = repoLine(view.ledger)

  return [
    view.watch === null ? 'Full check: none found yet' : `Full check: ${view.watch.verdict}`,
    ...(view.last === undefined ? [] : detailLines(view.last.lines)),
    ...scoreLines(view.bets, view.unbet),
    ...betRows(view.bets),
    ...(repo === undefined ? [] : [repo]),
    recordHeader(view.records),
    ...recordRows(view.records.slice(-RECORDS_SHOWN), view.columns),
  ].map(row => row.slice(0, view.columns))
}
