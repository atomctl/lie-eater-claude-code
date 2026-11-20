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
  /** The test command the referee locked at the summon. */
  verdict: string
  /** What happened after the summon, in order. */
  steps: Step[]
  /** The agent's final message. */
  answer: string
  /** Numbers the person gave in a prompt. */
  promptNumbers: string[]
  expect: {
    kept: boolean
    /** The rules that must be reported as broken. */
    broken: TermId[]
    /** 1 when a number with no source must be noted, else 0. */
    notes: number
    /** How each bet must end, in order. */
    bets: Bet['state'][]
  }
}

export const call = (raw: RawCall): Step => ({ kind: 'call', ...raw })
export const bet = (expect: 'pass' | 'fail', confidence: number): Step => ({ kind: 'bet', expect, confidence })
export const bash = (command: string, text: string, isError = false): Step =>
  call({ tool: 'Bash', command, text, ...(isError ? { isError: true } : {}) })
export const edit = (path: string, oldText: string, newText: string): Step =>
  call({ tool: 'Edit', path, oldText, newText, text: `The file ${path} has been updated successfully.` })
export const write = (path: string, newText: string, oldText = ''): Step =>
  call({ tool: 'Write', path, oldText, newText, text: `File created successfully at: ${path}` })
