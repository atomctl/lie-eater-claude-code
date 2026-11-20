// The recorder's side of the session state: taking in a tool call, starting a
// turn, and the view the pane draws from.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Bet, Ruling, Terms, ToolRecord } from '../../types'
import { appendRecord, nextMeta, toRawCall } from './intake'
import { META_START, SHAPE } from './state'

const records = atom({ plugin: 'lie-eater', key: 'records' } as const, [], { shape: SHAPE.records })
const terms = atom({ plugin: 'lie-eater', key: 'terms' } as const, null, { shape: SHAPE.terms })
const rulings = atom({ plugin: 'lie-eater', key: 'rulings' } as const, [], { shape: SHAPE.rulings })
const bets = atom({ plugin: 'lie-eater', key: 'bets' } as const, [], { shape: SHAPE.bets })
const meta = atom({ plugin: 'lie-eater', key: 'meta' } as const, META_START, { shape: SHAPE.meta })

/** Records one finished tool call and hands back the record. */
export async function remember(
  $: EngineInterface,
  input: Record<string, unknown>,
  ran: { text?: string; isError?: boolean; result?: unknown },
): Promise<ToolRecord | undefined> {
  const raw = toRawCall(input, ran)
  const { turn } = await read($, meta)
  const at = await $.clock.now()
  let made: ToolRecord | undefined
  // The id is given inside the one update, so calls that run side by side keep their order.
  await update($, records, list => {
    const next = appendRecord(list, raw, turn, at)
    made = next.at(-1)

    return next
  })

  return made
}

/** A new prompt starts a turn. `isOwn` marks a prompt this mod sent itself. */
export async function startTurn($: EngineInterface, prompt: string, isOwn: boolean): Promise<void> {
  await update($, meta, m => nextMeta(m, prompt, isOwn))
}

export type PaneView = {
  game: Terms | null
  ruling: Ruling | undefined
  list: readonly ToolRecord[]
  bets: readonly Bet[]
  unbet: number
  note: string | undefined
}

/** What the pane draws from. Reading it while drawing makes the pane follow every change. */
export async function paneView($: EngineInterface): Promise<PaneView> {
  const game = await read($, terms)
  const all = await read($, rulings)

  const { note, unbet } = await read($, meta)

  return {
    game,
    ruling: game === null ? undefined : all.findLast(r => r.termsId === game.id),
    list: await read($, records),
    bets: await read($, bets),
    unbet,
    note,
  }
}

export async function isRefereePresent($: EngineInterface): Promise<boolean> {
  return (await read($, terms))?.state === 'in play'
}
