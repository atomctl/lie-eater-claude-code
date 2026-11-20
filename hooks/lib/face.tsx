// What the pane shows, as plain lines of text with a tone. register.tsx draws them.
import type { Bet, Ledger, Ruling, Terms, ToolRecord } from '../../types'
import { betText, score, youLine } from './bets'
import { openDebt, repoLine, streak } from './ledger'
import { isKept } from './terms'
import { VOICE, rulingText, termsText, verdictOf } from './words'

export type Tone = 'title' | 'plain' | 'good' | 'bad' | 'quiet'
export type Row = { text: string; tone: Tone }

const MARK: Record<ToolRecord['state'], string> = { clean: '✓', failed: '✗', unknown: '?' }

/** One line per record, the oldest first, each cut to the pane's width. */
export function recordRows(records: readonly ToolRecord[], columns: number): string[] {
  return records.map(r => `#${r.id} ${r.kind} ${MARK[r.state]} ${r.target}`.trimEnd().slice(0, columns))
}

export function recordHeader(records: readonly ToolRecord[]): string {
  const first = records[0]
  const last = records.at(-1)

  return first === undefined || last === undefined
    ? 'No tool calls yet.'
    : `Calls recorded: ${records.length} (#${first.id} to #${last.id})`
}

const toneOf = (line: string): Tone =>
  line.startsWith('✓')
    ? 'good'
    : line.startsWith('✗')
      ? 'bad'
      : line.startsWith('RULING') || line.startsWith('VERDICT')
        ? 'title'
        : line.startsWith(' ') || line.startsWith('?')
          ? 'quiet'
          : 'plain'

const END_ROW: Record<ReturnType<typeof verdictOf>, Row> = {
  kept: { text: VOICE.kept, tone: 'good' },
  broken: { text: VOICE.broken, tone: 'bad' },
  unproven: { text: VOICE.unproven, tone: 'quiet' },
}

/** The referee's part of the pane: who is present, the rules, the newest ruling. */
export function refereeRows(game: Terms | null, ruling: Ruling | undefined, columns: number, number?: number): Row[] {
  if (game === null) {
    return [{ text: VOICE.absent.slice(0, columns), tone: 'quiet' }]
  }

  const rows: Row[] = [
    {
      text:
        game.state === 'in play'
          ? `THE REFEREE IS PRESENT${number === undefined ? '' : ` · No. ${number}`} · game ${game.id}`
          : `Last game: ${game.id}`,
      tone: 'title',
    },
    // The pane is short: a ruling says each rule again, so it takes the place of the list.
    ...(ruling === undefined ? termsText(game).map((text): Row => ({ text, tone: 'plain' })) : []),
  ]

  if (ruling !== undefined) {
    const shown = { final: ruling.final, ...(ruling.debt === undefined ? {} : { debt: ruling.debt }) }
    const lines = rulingText(ruling.lines, shown).filter(line => line !== '')

    if (ruling.overruled === true) {
      // The person has decided: the ruling stays readable, but it no longer speaks.
      rows.push(...lines.map((text): Row => ({ text, tone: 'quiet' })), { text: '(overruled by the person)', tone: 'quiet' })
    } else {
      rows.push(...lines.map((text): Row => ({ text, tone: toneOf(text) })))
      if (ruling.lie) rows.push({ text: VOICE.lie, tone: 'bad' })
      if (ruling.final) rows.push(END_ROW[verdictOf(ruling.lines)])
    }
  }

  return rows.map(row => ({ ...row, text: row.text.slice(0, columns) }))
}

const BET_WORD: Record<Bet['state'], string> = { open: 'OPEN', won: 'WON', lost: 'LOST', void: 'VOID' }
const BET_TONE: Record<Bet['state'], Tone> = { open: 'plain', won: 'good', lost: 'bad', void: 'quiet' }
const BETS_SHOWN = 3

/** The newest bets, two lines each: what was said, then how it ended. */
export function betRows(bets: readonly Bet[], columns: number): Row[] {
  return bets
    .slice(-BETS_SHOWN)
    .reverse()
    .flatMap((b): Row[] => [
      { text: `#${b.id} ${betText(b)}`, tone: 'plain' },
      {
        text: `    ${BET_WORD[b.state]}${b.line === undefined ? '' : ` · ${b.line}`}${
          b.state === 'open' && b.you !== undefined ? ` · you: it will ${b.you}` : ''
        }`,
        tone: BET_TONE[b.state],
      },
    ])
    .map(row => ({ ...row, text: row.text.slice(0, columns) }))
}

/** The score in plain words, and the counts under it. */
export function scoreLines(bets: readonly Bet[], unbet: number): Row[] {
  const settled = bets.filter(b => b.state === 'won' || b.state === 'lost')
  const voids = bets.filter(b => b.state === 'void').length
  const s = score(settled.map(b => ({ confidence: b.confidence, won: b.state === 'won' })))

  if (s === undefined && voids === 0 && unbet === 0) {
    return []
  }

  const counts = `Bets: ${s?.won ?? 0} won, ${s?.lost ?? 0} lost${voids === 0 ? '' : `, ${voids} void`}`
  const noBet = unbet === 0 ? '' : ` · ${unbet} ${unbet === 1 ? 'run' : 'runs'} without a bet`

  return [
    ...(s === undefined
      ? []
      : [
          {
            text: `The AI said "${Math.round(s.said * 100)}% sure". It was right ${s.won} of ${s.n} times.`,
            tone: 'plain' as const,
          },
        ]),
    { text: `${counts}${noBet}`, tone: 'quiet' },
    ...(youLine(bets) === undefined ? [] : [{ text: youLine(bets) ?? '', tone: 'plain' as const }]),
  ]
}

const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅']

/** A new face every quarter of a second. */
export function diceFace(now: number): string {
  return FACES[Math.floor(now / 250) % FACES.length] ?? '⚀'
}

/** "Fix this" is offered while a game is in play and its newest ruling has a broken rule. */
export function canFix(game: Terms | null, ruling: Ruling | undefined): boolean {
  return game?.state === 'in play' && ruling !== undefined && ruling.overruled !== true && !isKept(ruling.lines)
}

/** What the house remembers about this repository: the streak, the record, the debt. */
export function houseRows(ledger: Ledger, columns: number): Row[] {
  const record = repoLine(ledger)
  const debt = openDebt(ledger).length
  const rows: Row[] = [
    ...(ledger.games.length === 0 ? [] : [{ text: `Clean games in a row: ${streak(ledger)}`, tone: 'plain' as const }]),
    ...(record === undefined ? [] : [{ text: record, tone: 'quiet' as const }]),
    ...(debt === 0 ? [] : [{ text: `Debt: ${debt} open`, tone: 'bad' as const }]),
  ]

  return rows.map(row => ({ ...row, text: row.text.slice(0, columns) }))
}
