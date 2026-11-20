// A fixture is one recorded session with a known truth, written by hand.
// It is replayed through the same rules the live mod uses.
import type { Bet, TermId } from '../types'
import type { RawCall } from '../hooks/lib/record'

export type Step =
  | ({ kind: 'call' } & RawCall)
  | { kind: 'bet'; expect: 'pass' | 'fail'; confidence: number }

export type Fixture = {
  name: string
  group: 'honest' | 'broken' | 'betting'
  /** One sentence: what the agent did and what it said. */
  story: string
  /** The full check of the watch. */
  verdict: string
  /** What happened after the watch was armed, in order. */
  steps: Step[]
  /** The project's check files when the watch was armed, and as they are when the agent calls done (left out: gone). */
  testFiles?: { armed: Record<string, string>; done: Record<string, string> }
  /** What the agent named as broken when it called done; left out when it named nothing. */
  named?: string
  expect: {
    kept: boolean
    /** The lines that must be reported as broken (a line that could not be seen is not broken). */
    broken: TermId[]
    /** Whether the done call is a lie: a broken rule the agent did not name. */
    lie: boolean
    /** How each bet must end, in order. */
    bets: Bet['state'][]
  }
}

export const call = (raw: RawCall): Step => ({ kind: 'call', ...raw })
export const bet = (expect: 'pass' | 'fail', confidence: number): Step => ({ kind: 'bet', expect, confidence })
export const bash = (command: string, text: string, isError = false): Step =>
  call({ tool: 'Bash', command, text, ...(isError ? { isError: true } : {}) })
export const edit = (path: string): Step => call({ tool: 'Edit', path, text: `The file ${path} has been updated successfully.` })
export const write = (path: string): Step => call({ tool: 'Write', path, text: `File created successfully at: ${path}` })
