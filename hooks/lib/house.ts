// What Lie Eater keeps in the person's repository (the ledger of bets, the
// receipts and the card) and the one status line.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Bet, Ledger, Terms } from '../../types'
import { youWon } from './bets'
import { cardSvg } from './card'
import { EMPTY_LEDGER, LEDGER_PATH, addBet, isLedgerText, parseLedger } from './ledger'
import { inProject } from './project'
import { CARD_SVG, RECEIPTS_JSON, RECEIPTS_MD, buildReceipt, receiptToMarkdown } from './receipts'
import { nowOf } from './result'
import { META_START, SHAPE } from './state'
import { hasChanged } from './terms'

// Each file that touches state declares its own atoms (see state.ts).
const watch = atom({ plugin: 'lie-eater', key: 'watch' } as const, null, { shape: SHAPE.watch })
const bets = atom({ plugin: 'lie-eater', key: 'bets' } as const, [], { shape: SHAPE.bets })
const rulings = atom({ plugin: 'lie-eater', key: 'rulings' } as const, [], { shape: SHAPE.rulings })
const ledger = atom({ plugin: 'lie-eater', key: 'ledger' } as const, EMPTY_LEDGER, { shape: SHAPE.ledger })
const meta = atom({ plugin: 'lie-eater', key: 'meta' } as const, META_START, { shape: SHAPE.meta })

const LEDGER_ASIDE = '.lie-eater/ledger.unreadable.json'

// Past an import the engine follows `$` only into a function declaration.
async function today($: EngineInterface): Promise<string> {
  return new Date(await $.clock.now()).toISOString()
}

async function change($: EngineInterface, fn: (l: Ledger) => Ledger): Promise<void> {
  let next = EMPTY_LEDGER
  await update($, ledger, l => {
    next = fn(l)

    return next
  })
  // A folder that cannot be written to must not stop a result: the session keeps its copy.
  await $.fs.write(await inProject($, LEDGER_PATH), `${JSON.stringify(next, null, 2)}\n`).catch(() => undefined)
}

/** The one status line: what the person may believe about "done" right now. */
export async function refreshStatus($: EngineInterface): Promise<void> {
  const w = await read($, watch)
  const last = w === null ? undefined : (await read($, rulings)).findLast(r => r.termsId === w.id)

  $.ui.status(nowOf({ armed: w !== null, changed: w !== null && hasChanged(w), ...(last === undefined ? {} : { last }) }).status)
}

/** The start of a session: the ledger file is the truth for the bets. */
export async function loadLedger($: EngineInterface): Promise<void> {
  const text = await $.fs.read(await inProject($, LEDGER_PATH)).catch(() => undefined)

  // A file this version cannot read (a newer version, a merge conflict) is the
  // person's history: it is kept aside before anything is written over it.
  if (text !== undefined && text.trim() !== '' && !isLedgerText(text)) {
    await $.fs.write(await inProject($, LEDGER_ASIDE), text).catch(() => undefined)
  }

  const found = parseLedger(text)
  await update($, ledger, () => found)
}

export async function recordBet($: EngineInterface, b: Bet): Promise<void> {
  // A demo leaves nothing in the ledger.
  if ((b.state !== 'won' && b.state !== 'lost') || (await read($, watch))?.demo === true) {
    return
  }

  const at = await today($)
  const called = youWon(b)
  await change($, l =>
    addBet(l, { at, confidence: b.confidence, won: b.state === 'won', ...(called === undefined ? {} : { youWon: called }) }),
  )
}

/** Writes the receipts and the card of this watch into the person's repository. */
export async function writeReceipts($: EngineInterface, w: Terms): Promise<void> {
  const receipt = buildReceipt({
    watch: w,
    rulings: await read($, rulings),
    bets: await read($, bets),
    unbet: (await read($, meta)).unbet,
    ledger: await read($, ledger),
    createdAt: await today($),
  })
  // A folder that cannot be written to must not stop a result.
  await $.fs.write(await inProject($, RECEIPTS_JSON), `${JSON.stringify(receipt, null, 2)}\n`).catch(() => undefined)
  await $.fs.write(await inProject($, RECEIPTS_MD), receiptToMarkdown(receipt)).catch(() => undefined)
  await $.fs.write(await inProject($, CARD_SVG), cardSvg(receipt)).catch(() => undefined)
}
