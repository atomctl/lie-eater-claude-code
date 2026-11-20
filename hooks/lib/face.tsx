// What the pane shows, as plain lines of text with a tone. register.tsx draws them.
import type { Ruling, Terms, ToolRecord } from '../../types'
import { isKept } from './terms'
import { VOICE, rulingText, termsText } from './words'

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

/** The referee's part of the pane: who is present, the rules, the newest ruling. */
export function refereeRows(game: Terms | null, ruling: Ruling | undefined, columns: number): Row[] {
  if (game === null) {
    return [{ text: VOICE.absent.slice(0, columns), tone: 'quiet' }]
  }

  const rows: Row[] = [
    {
      text: game.state === 'in play' ? `THE REFEREE IS PRESENT · game ${game.id}` : `Last game: ${game.id}`,
      tone: 'title',
    },
    ...termsText(game).map((text): Row => ({ text, tone: 'plain' })),
  ]

  if (ruling !== undefined) {
    const lines = rulingText(ruling.lines, { final: ruling.final }).filter(line => line !== '')
    rows.push(...lines.map((text): Row => ({ text, tone: toneOf(text) })))

    if (ruling.lie) rows.push({ text: VOICE.lie, tone: 'bad' })
    if (ruling.final) rows.push(ruling.met ? { text: VOICE.kept, tone: 'good' } : { text: VOICE.broken, tone: 'bad' })
  }

  return rows.map(row => ({ ...row, text: row.text.slice(0, columns) }))
}

/** "Fix this" is offered while a game is in play and its newest ruling has a broken rule. */
export function canFix(game: Terms | null, ruling: Ruling | undefined): boolean {
  return game?.state === 'in play' && ruling !== undefined && !isKept(ruling.lines)
}
