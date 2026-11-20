// The recorder's side of the session state: taking in a tool call, starting a
// turn, and the view the pane draws from.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Bet, Ledger, Ruling, Terms, ToolRecord } from '../../types'
import { appendRecord, nextMeta, toRawCall } from './intake'
import { EMPTY_LEDGER } from './ledger'
import { projectRoot } from './project'
import { META_START, SHAPE } from './state'
import { isTheVerdict, plainCommand, summon, track } from './terms'

const records = atom({ plugin: 'lie-eater', key: 'records' } as const, [], { shape: SHAPE.records })
const terms = atom({ plugin: 'lie-eater', key: 'terms' } as const, null, { shape: SHAPE.terms })
const rulings = atom({ plugin: 'lie-eater', key: 'rulings' } as const, [], { shape: SHAPE.rulings })
const watch = atom({ plugin: 'lie-eater', key: 'watch' } as const, null, { shape: SHAPE.watch })
const bets = atom({ plugin: 'lie-eater', key: 'bets' } as const, [], { shape: SHAPE.bets })
const ledger = atom({ plugin: 'lie-eater', key: 'ledger' } as const, EMPTY_LEDGER, { shape: SHAPE.ledger })
const meta = atom({ plugin: 'lie-eater', key: 'meta' } as const, META_START, { shape: SHAPE.meta })

/** Records one finished tool call and hands back the record. */
export async function remember(
  $: EngineInterface,
  input: Record<string, unknown>,
  ran: { text?: string; isError?: boolean; result?: unknown },
): Promise<ToolRecord | undefined> {
  const raw = toRawCall(input, ran, await projectRoot($))
  const game = await read($, terms)

  if (raw.command !== undefined && game?.state === 'in play' && isTheVerdict(game, raw.command)) {
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

  const r = made as ToolRecord | undefined

  if (r !== undefined) {
    await update($, watch, w => (w === null ? watchFrom(r) : track(w, r)))
  }

  return r
}

// With no config file to read, the first plain test run names the test command.
function watchFrom(r: ToolRecord): Terms | null {
  const command = plainCommand(r.target)

  return r.kind === 'test' && !/[|;&]/.test(command) ? track(summon(command, { id: 0, at: r.at }, []), r) : null
}

/** A new prompt starts a turn. */
export async function startTurn($: EngineInterface): Promise<void> {
  await update($, meta, nextMeta)
}

export type PaneView = {
  game: Terms | null
  ruling: Ruling | undefined
  list: readonly ToolRecord[]
  bets: readonly Bet[]
  unbet: number
  ledger: Ledger
  referee: number | undefined
}

/** What the pane draws from. Reading it while drawing makes the pane follow every change. */
export async function paneView($: EngineInterface): Promise<PaneView> {
  const game = await read($, terms)
  const all = await read($, rulings)

  const { unbet, referee } = await read($, meta)

  return {
    game,
    ruling: game === null ? undefined : all.findLast(r => r.termsId === game.id),
    list: await read($, records),
    bets: await read($, bets),
    unbet,
    ledger: await read($, ledger),
    referee,
  }
}
