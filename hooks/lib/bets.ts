// Bets: the agent says what it expects before a test or build run, and the
// real result settles it. Plain rules; no model, no engine.
import type { Bet, ToolRecord } from '../../types'
import { classifyCommand, evidenceLine } from './record'
import { isVerdictRun } from './terms'

export const BET_TOOL = 'bet'
export const BET_TOOL_FULL = 'mcp__lie-eater__bet'

// A mod cannot add to the system prompt, so the tool's description carries the rule.
export const BET_DESCRIPTION =
  'Lie Eater referee. While a referee is present, call this once before each test or build run: say whether you expect the run to pass or fail, and how sure you are (0.5 to 0.99). A run without a bet is refused. The bet is settled from the real result, and the person sees how often you were right. Run the test command as written.'

export const BET_SCHEMA = {
  type: 'object',
  properties: {
    expect: { enum: ['pass', 'fail'] },
    confidence: { type: 'number', minimum: 0.5, maximum: 0.99 },
    why: { type: 'string', maxLength: 200 },
  },
  required: ['expect', 'confidence'],
}

export const GATE_TEXT =
  'Lie Eater: the referee takes your bet first. Call mcp__lie-eater__bet with expect ("pass" or "fail") and confidence (0.5 to 0.99), then run this command again.'

/**
 * The refusal names the test command: the agent has no other way to learn it.
 * A runner the referee does not know is read by how it exits, so a pipe would hide its result.
 */
export function gateText(verdict: string): string {
  const kind = classifyCommand(verdict)
  const how =
    kind === 'test' || kind === 'build'
      ? 'run it as written (a pipe to tail is fine).'
      : 'run it by itself, with no pipe. The referee does not know this runner and reads only how it exits.'

  return `${GATE_TEXT} The test command of this game is \`${verdict}\`: ${how}`
}

const BAD_BET = 'Bet refused: give expect ("pass" or "fail") and confidence (0.5 to 0.99).'
const BET_OPEN = 'Bet refused: a bet is already open.'
const BETS_KEPT = 100

/** A run that needs a bet: a test run, a build, or the verdict command. */
export function isGated(command: string, verdict: string): boolean {
  const kind = classifyCommand(command)

  return kind === 'test' || kind === 'build' || isVerdictRun(command, verdict)
}

export function betText(b: Pick<Bet, 'expect' | 'confidence'>): string {
  return `the next run will ${b.expect}, ${Math.round(b.confidence * 100)}% sure`
}

export function postBet(
  bets: readonly Bet[],
  input: unknown,
  ctx: { id: number; turn: number; at: number; afterRecord: number },
): { bets: Bet[]; reply: string } {
  const given = (input !== null && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const { expect, confidence, why } = given

  if (
    (expect !== 'pass' && expect !== 'fail') ||
    typeof confidence !== 'number' ||
    !(confidence >= 0.5 && confidence <= 0.99)
  ) {
    return { bets: [...bets], reply: BAD_BET }
  }

  if (bets.some(b => b.state === 'open')) {
    return { bets: [...bets], reply: BET_OPEN }
  }

  const bet: Bet = {
    ...ctx,
    expect,
    confidence,
    why: typeof why === 'string' ? why.slice(0, 200) : '',
    state: 'open',
  }

  return { bets: [...bets, bet].slice(-BETS_KEPT), reply: `Bet #${bet.id} taken: ${betText(bet)}.` }
}

/**
 * Settles an open bet with a run that came after it. `hadChange` is false when
 * no code changed since the last run: the result was known, so the bet is void.
 */
export function settleBet(b: Bet, r: ToolRecord, hadChange: boolean): Bet {
  if (b.state !== 'open' || r.id <= b.afterRecord || r.state === 'unknown') {
    return b
  }

  if (!hadChange) {
    return { ...b, state: 'void', record: r.id, line: 'nothing changed since the last run' }
  }

  const passed = r.state === 'clean'

  return { ...b, state: passed === (b.expect === 'pass') ? 'won' : 'lost', record: r.id, line: evidenceLine(r) }
}

/** Bet against your AI: the person calls the open bet too. The call may change until the run settles it. */
export function callBet(bets: readonly Bet[], call: 'pass' | 'fail'): { bets: Bet[]; reply: string } {
  if (!bets.some(b => b.state === 'open')) {
    return { bets: [...bets], reply: 'No bet is open.' }
  }

  return {
    bets: bets.map(b => (b.state === 'open' ? { ...b, you: call } : b)),
    reply: `You called it: the next run will ${call}.`,
  }
}

// Did the run pass? A won bet on "pass" and a lost bet on "fail" both mean it did.
const ranClean = (b: Bet): boolean => (b.state === 'won') === (b.expect === 'pass')

/** Was the person's call right? Undefined when there was no call or the bet did not settle. */
export function youWon(b: Bet): boolean | undefined {
  return b.you === undefined || (b.state !== 'won' && b.state !== 'lost') ? undefined : (b.you === 'pass') === ranClean(b)
}

/** `You 3 of 5 · the AI 4 of 5`, over the runs the person called. */
export function youLine(bets: readonly Bet[]): string | undefined {
  const called = bets.filter(b => youWon(b) !== undefined)

  if (called.length === 0) {
    return undefined
  }

  const you = called.filter(b => youWon(b) === true).length
  const ai = called.filter(b => b.state === 'won').length

  return `You ${you} of ${called.length} · the AI ${ai} of ${called.length}`
}

/** A bet that no run settled by the end of the turn is void. */
export function closeTurn(bets: readonly Bet[]): Bet[] {
  return bets.map(b => (b.state === 'open' ? { ...b, state: 'void', line: 'no run settled it' } : b))
}

export function score(
  entries: readonly { confidence: number; won: boolean }[],
): { n: number; won: number; lost: number; hitRate: number; said: number } | undefined {
  const n = entries.length

  if (n === 0) {
    return undefined
  }

  const won = entries.filter(e => e.won).length
  const said = entries.reduce((sum, e) => sum + e.confidence, 0) / n

  return { n, won, lost: n - won, hitRate: won / n, said: Number(said.toFixed(4)) }
}
