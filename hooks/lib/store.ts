// The recorder's side of the session state: taking in a tool call, starting a
// turn, and the view the pane draws from.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Bet, Ledger, Ruling, Terms, ToolRecord } from '../../types'
import { appendRecord, nextMeta, toRawCall } from './intake'
import { EMPTY_LEDGER } from './ledger'
import { projectRoot } from './project'
import { nowOf } from './result'
import type { Now } from './result'
import { META_START, SHAPE } from './state'
import { hasChanged, isTheVerdict } from './terms'

const records = atom({ plugin: 'lie-eater', key: 'records' } as const, [], { shape: SHAPE.records })
const watch = atom({ plugin: 'lie-eater', key: 'watch' } as const, null, { shape: SHAPE.watch })
const rulings = atom({ plugin: 'lie-eater', key: 'rulings' } as const, [], { shape: SHAPE.rulings })
const bets = atom({ plugin: 'lie-eater', key: 'bets' } as const, [], { shape: SHAPE.bets })
const ledger = atom({ plugin: 'lie-eater', key: 'ledger' } as const, EMPTY_LEDGER, { shape: SHAPE.ledger })
const meta = atom({ plugin: 'lie-eater', key: 'meta' } as const, META_START, { shape: SHAPE.meta })
const closing = atom({ plugin: 'lie-eater', key: 'closing' } as const, null, { shape: SHAPE.closing })

/** Records one finished tool call and hands back the record. */
export async function remember(
  $: EngineInterface,
  input: Record<string, unknown>,
  ran: { text?: string; isError?: boolean; result?: unknown },
): Promise<ToolRecord | undefined> {
  const raw = toRawCall(input, ran, await projectRoot($))
  const w = await read($, watch)

  if (raw.command !== undefined && w !== null && isTheVerdict(w, raw.command)) {
    raw.isVerdict = true
  }

  const { turn } = await read($, meta)
  const at = await $.clock.now()
  let made: ToolRecord | undefined
  // The id is given inside the one update, so calls that run side by side keep their order.
  await update($, records, list => {
    const next = appendRecord(list, raw, turn, at)
    made = next.at(-1)

    return next
  })

  return made as ToolRecord | undefined
}

/** A new prompt starts a turn. */
export async function startTurn($: EngineInterface): Promise<void> {
  await update($, meta, nextMeta)
}

export type PaneView = {
  now: Now
  closing: readonly string[] | null
  watch: Terms | null
  last: Ruling | undefined
  records: readonly ToolRecord[]
  bets: readonly Bet[]
  unbet: number
  ledger: Ledger
}

/** What the pane draws from. Reading it while drawing makes the pane follow every change. */
export async function paneView($: EngineInterface): Promise<PaneView> {
  const w = await read($, watch)
  const all = await read($, rulings)
  const last = w === null ? undefined : all.findLast(r => r.termsId === w.id)

  return {
    now: nowOf({ armed: w !== null, changed: w !== null && hasChanged(w), ...(last === undefined ? {} : { last }) }),
    closing: await read($, closing),
    watch: w,
    last,
    records: await read($, records),
    bets: await read($, bets),
    unbet: (await read($, meta)).unbet,
    ledger: await read($, ledger),
  }
}
