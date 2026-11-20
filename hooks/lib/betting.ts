// What happens around a bet in a live session: taking it, the gate that asks
// for it, and settling it on the run's result. The rules themselves are in
// bets.ts. The person sees bets under Details; a lost bet also gets one toast, no sound.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Bet, Terms, ToolRecord } from '../../types'
import { betText, callBet, closeTurn, gateText, isGated, lostToast, postBet, settleBet } from './bets'
import { recordBet } from './house'
import { META_START, SHAPE } from './state'
import { howRun } from './terms'

// Each file that touches state declares its own atoms (see state.ts).
const records = atom({ plugin: 'lie-eater', key: 'records' } as const, [], { shape: SHAPE.records })
const watch = atom({ plugin: 'lie-eater', key: 'watch' } as const, null, { shape: SHAPE.watch })
const bets = atom({ plugin: 'lie-eater', key: 'bets' } as const, [], { shape: SHAPE.bets })
const meta = atom({ plugin: 'lie-eater', key: 'meta' } as const, META_START, { shape: SHAPE.meta })

const REFUSALS_PER_TURN = 2
const NO_CHECKS = 'Lie Eater: this project has no checks yet. No bet taken.'

/** The bet tool: the agent says what it expects of the next run. */
export async function takeBet($: EngineInterface, input: unknown): Promise<string> {
  const w = await read($, watch)

  if (w === null) {
    return NO_CHECKS
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

    // A mod cannot add to the system prompt: the bet's reply is where the agent hears which command is the full check.
    return `${reply} The full check of this project is \`${w.verdict}\`.`
  }

  return reply
}

/**
 * The gate: while a watch is armed, a test or build run of the main agent
 * with no open bet is refused, twice per turn at most. After that the run goes
 * through and is counted, so the agent is never stuck. Hands back the text of
 * the refusal, or undefined when the run may go on.
 */
export async function refuseRun($: EngineInterface, input: Record<string, unknown>): Promise<string | undefined> {
  if (input.tool !== 'Bash' || input.agentId !== undefined || typeof input.command !== 'string') {
    return undefined
  }

  const w = await read($, watch)

  if (w === null || !isGated(input.command, w.verdict)) {
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

  return gateText(w.verdict)
}

/**
 * Settles the open bet with a run of the main agent. `before` is the watch as
 * it was before this run. Hands back the line the agent reads on the run's
 * result: it informs, it never gives an order.
 */
export async function settle($: EngineInterface, r: ToolRecord, before: Terms | undefined): Promise<string | undefined> {
  if (before === undefined || r.tool !== 'Bash' || r.agentId !== undefined || !isGated(r.target, before.verdict)) {
    return undefined
  }

  // A run whose result could not be read made nothing known.
  const lastRead = before.lastReadRun ?? before.lastGatedRun
  const hadChange = lastRead === 0 || before.lastEdit > lastRead
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

  // A passing run of the full check by itself may be the end of the task; a piped one, or one with extra options, cannot be.
  const how = howRun(before, r.target)
  const hint =
    how === 'chained'
      ? ` This run cannot show that the work is done: run \`${before.verdict}\` by itself before you call done.`
      : how === 'extra'
        ? ` This run is not the full check: run \`${before.verdict}\` exactly, by itself, before you call done.`
        : how === 'full' && r.state === 'clean'
          ? ' If the task is finished, call the done tool.'
          : ''

  if (done.state === 'void') {
    return `Lie Eater: bet #${done.id} VOID. Nothing changed since the last run.${hint}`
  }

  await recordBet($, done)

  if (done.state === 'lost') {
    $.ui.toast(lostToast(done))
  }

  return `Lie Eater: bet #${done.id} ${done.state === 'won' ? 'WON' : 'LOST'}. You said ${betText(done)}. The run: ${done.line ?? ''}.${hint}`
}

/** Bet against your AI: the person's own call on the open bet (a button under Details, or `/call`). */
export async function callIt($: EngineInterface, call: string): Promise<string> {
  const asked = call.trim()

  if (asked !== 'pass' && asked !== 'fail') {
    return (await openBet($)) === undefined ? 'No bet is open.' : 'Type /call pass or /call fail while a bet is open.'
  }

  let reply = ''
  await update($, bets, list => {
    const out = callBet(list, asked)
    reply = out.reply

    return out.bets
  })

  return reply
}

/** The end of a turn: a bet that no run settled is void. */
export async function closeBets($: EngineInterface): Promise<void> {
  await update($, bets, list => (list.some(b => b.state === 'open') ? closeTurn(list) : list))
}

async function openBet($: EngineInterface): Promise<Bet | undefined> {
  return (await read($, bets)).find(b => b.state === 'open')
}
