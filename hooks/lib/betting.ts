// What happens around a bet in a live session: taking it, the gate that asks
// for it, settling it on the run's result, and the dice. The rules themselves
// are in bets.ts.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Timer } from 'claude-code'

import type { Bet, Terms, ToolRecord } from '../../types'
import { betText, closeTurn, gateText, isGated, postBet, settleBet } from './bets'
import { debtNote, recordBet, refreshStatus } from './house'
import { thump } from './referee'
import { META_START, SHAPE } from './state'
import { VOICE } from './words'

// Each file that touches state declares its own atoms (see state.ts).
const records = atom({ plugin: 'lie-eater', key: 'records' } as const, [], { shape: SHAPE.records })
const terms = atom({ plugin: 'lie-eater', key: 'terms' } as const, null, { shape: SHAPE.terms })
const bets = atom({ plugin: 'lie-eater', key: 'bets' } as const, [], { shape: SHAPE.bets })
const meta = atom({ plugin: 'lie-eater', key: 'meta' } as const, META_START, { shape: SHAPE.meta })

const REFUSALS_PER_TURN = 2
const NO_REFEREE = 'No referee is present. No bet taken.'

// The dice turns while a bet is open. A reload drops the timer; the dice then
// shows one face until the bet settles.
let dice: Timer | undefined

function rollDice($: EngineInterface): void {
  dice ??= $.clock.every(250, () => $.ui.invalidate('ui.render'))
}

function stopDice(): void {
  dice?.cancel()
  dice = undefined
}

/** The bet tool: the agent says what it expects of the next run. */
export async function takeBet($: EngineInterface, input: unknown): Promise<string> {
  const game = await read($, terms)

  if (game?.state !== 'in play') {
    return NO_REFEREE
  }

  const { betSeq, turn } = await read($, meta)
  const afterRecord = (await read($, records)).at(-1)?.id ?? 0
  const at = await $.clock.now()
  let reply = ''
  let isTaken = false
  await update($, bets, list => {
    const out = postBet(list, input, { id: betSeq + 1, turn, at, afterRecord })
    reply = out.reply
    isTaken = out.bets.length > list.length

    return out.bets
  })

  if (isTaken) {
    await update($, meta, m => ({ ...m, betSeq: betSeq + 1 }))
    rollDice($)

    // A mod cannot add to the system prompt: the bet's reply is where the agent
    // hears which command is the test run, and of the debt.
    return `${reply} The test command of this game is \`${game.verdict}\`.${await debtNote($)}`
  }

  return reply
}

/**
 * The gate: while a referee is present, a test or build run of the main agent
 * with no open bet is refused, twice per turn at most. After that the run goes
 * through and is counted, so the agent is never stuck. Hands back the text of
 * the refusal, or undefined when the run may go on.
 */
export async function refuseRun($: EngineInterface, input: Record<string, unknown>): Promise<string | undefined> {
  if (input.tool !== 'Bash' || input.agentId !== undefined || typeof input.command !== 'string') {
    return undefined
  }

  const game = await read($, terms)

  if (game?.state !== 'in play' || !isGated(input.command, game.verdict)) {
    return undefined
  }

  if ((await read($, bets)).some(b => b.state === 'open')) {
    return undefined
  }

  const { denies } = await read($, meta)

  if (denies >= REFUSALS_PER_TURN) {
    await update($, meta, m => ({ ...m, unbet: m.unbet + 1 }))

    return undefined
  }

  await update($, meta, m => ({ ...m, denies: m.denies + 1 }))
  $.ui.toast(VOICE.betAsked)

  return gateText(game.verdict)
}

/**
 * Settles the open bet with a run of the main agent. `before` is the game as it
 * was before this run. Hands back the line the agent reads on the run's result:
 * it informs, it never gives an order.
 */
export async function settle($: EngineInterface, r: ToolRecord, before: Terms | undefined): Promise<string | undefined> {
  if (before === undefined || r.tool !== 'Bash' || r.agentId !== undefined || !isGated(r.target, before.verdict)) {
    return undefined
  }

  const hadChange = before.lastGatedRun === 0 || before.lastCodeEdit > before.lastGatedRun
  let settled: Bet | undefined
  await update($, bets, list =>
    list.map(b => {
      const next = settleBet(b, r, hadChange)
      if (next !== b) settled = next

      return next
    }),
  )

  const done = settled as Bet | undefined

  if (done === undefined) {
    return undefined
  }

  stopDice()

  if (done.state === 'void') {
    return `Lie Eater: bet #${done.id} VOID. Nothing changed since the last run.`
  }

  const word = done.state === 'won' ? 'WON' : 'LOST'
  $.ui.toast(`BET ${word}: ${betText(done)}`)
  await recordBet($, done)
  await refreshStatus($)
  if (done.state === 'lost') thump($)

  return `Lie Eater: bet #${done.id} ${word}. You said ${betText(done)}. The run: ${done.line ?? ''}.`
}

/** The end of a turn: a bet that no run settled is void. */
export async function closeBets($: EngineInterface): Promise<void> {
  await update($, bets, list => (list.some(b => b.state === 'open') ? closeTurn(list) : list))
  stopDice()
}

export async function openBet($: EngineInterface): Promise<Bet | undefined> {
  return (await read($, bets)).find(b => b.state === 'open')
}
