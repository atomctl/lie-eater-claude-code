// What the pane shows, as plain lines of text.
import type { ToolRecord } from '../../types'

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
