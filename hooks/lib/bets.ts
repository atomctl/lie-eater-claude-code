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
