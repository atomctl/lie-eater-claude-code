import type { ToolRecord } from '../types'

/** A tool record with quiet defaults, for tests. */
export const rec = (partial: Partial<ToolRecord>): ToolRecord => ({
  id: 1,
  turn: 1,
  at: 0,
  tool: 'Bash',
  kind: 'other',
  target: '',
  state: 'clean',
  output: '',
  ...partial,
})
