// The house: the ledger file in the person's repository, the Debt, the status
// line and the overrule. "The house always collects": a broken game leaves a
// debt that only a kept game repays.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Bet, Ledger, RulingLine, Terms } from '../../types'
import { score } from './bets'
import {
  EMPTY_LEDGER,
  LEDGER_PATH,
  addBet,
  addDebt,
  addGame,
  dropGame,
  forgive,
  isLedgerText,
  openDebt,
  overrule,
  parseLedger,
  repay,
} from './ledger'
import { RECEIPTS_JSON, RECEIPTS_MD, buildReceipt, receiptToMarkdown } from './receipts'
import { META_START, SHAPE } from './state'
import { VOICE } from './words'

// Each file that touches state declares its own atoms (see state.ts).
const terms = atom({ plugin: 'lie-eater', key: 'terms' } as const, null, { shape: SHAPE.terms })
const bets = atom({ plugin: 'lie-eater', key: 'bets' } as const, [], { shape: SHAPE.bets })
const rulings = atom({ plugin: 'lie-eater', key: 'rulings' } as const, [], { shape: SHAPE.rulings })
const ledger = atom({ plugin: 'lie-eater', key: 'ledger' } as const, EMPTY_LEDGER, { shape: SHAPE.ledger })
const meta = atom({ plugin: 'lie-eater', key: 'meta' } as const, META_START, { shape: SHAPE.meta })

const LEDGER_ASIDE = '.lie-eater/ledger.unreadable.json'

// Past an import the engine follows `$` only into a function declaration.
async function today($: EngineInterface): Promise<string> {
  return new Date(await $.clock.now()).toISOString()
}

async function change($: EngineInterface, fn: (l: Ledger) => Ledger): Promise<Ledger> {
  let next = EMPTY_LEDGER
  await update($, ledger, l => {
    next = fn(l)

    return next
  })
  // A folder that cannot be written to must not stop a ruling: the session keeps its copy.
  await $.fs.write(LEDGER_PATH, `${JSON.stringify(next, null, 2)}\n`).catch(() => undefined)

  return next
}

/** One pinned line: who is present, the bets of this session, the open debt. */
export async function refreshStatus($: EngineInterface): Promise<void> {
  const debt = openDebt(await read($, ledger)).length
  const debtPart = debt === 0 ? [] : [`debt ${debt}`]

  if ((await read($, terms))?.state !== 'in play') {
    $.ui.status(debt === 0 ? undefined : ['Lie Eater', ...debtPart].join(' · '))

    return
  }

  const settled = (await read($, bets)).filter(b => b.state === 'won' || b.state === 'lost')
  const s = score(settled.map(b => ({ confidence: b.confidence, won: b.state === 'won' })))

  $.ui.status(['Referee present', ...(s === undefined ? [] : [`bets ${s.won}/${s.n}`]), ...debtPart].join(' · '))
}

/** At the start of a session the ledger file is the truth. */
export async function loadLedger($: EngineInterface): Promise<void> {
  const text = await $.fs.read(LEDGER_PATH).catch(() => undefined)

  // A file this version cannot read (a newer version, a merge conflict) is the
  // person's history: it is kept aside before anything is written over it.
  if (text !== undefined && text.trim() !== '' && !isLedgerText(text)) {
    await $.fs.write(LEDGER_ASIDE, text).catch(() => undefined)
  }

  const found = parseLedger(text)
  await update($, ledger, () => found)
  const debt = openDebt(found).length

  if (debt > 0 && (await read($, terms))?.state !== 'in play') {
    $.ui.toast(`${VOICE.remembers} Debt: ${debt}.`)
  }

  await refreshStatus($)
}

/** What the agent is told about the debt when it places a bet. */
export async function debtNote($: EngineInterface): Promise<string> {
  const debt = openDebt(await read($, ledger)).length

  return debt === 0
    ? ''
    : ` Open debt in this repository: ${debt}. Only a game that ends with the rules kept repays it.`
}

export async function recordBet($: EngineInterface, b: Bet): Promise<void> {
  if (b.state !== 'won' && b.state !== 'lost') {
    return
  }

  const at = await today($)
  await change($, l => addBet(l, { at, confidence: b.confidence, won: b.state === 'won' }))
}

/**
 * Takes a ruling into the ledger: a lie or a game that ends broken makes a
 * debt, a game that ends kept repays all of it. For a final ruling, hands back
 * the debt before this game and now, when the two differ.
 */
export async function recordRuling(
  $: EngineInterface,
  game: Terms,
  r: { lines: readonly RulingLine[]; met: boolean; lie: boolean; final: boolean },
): Promise<[number, number] | undefined> {
  if (!r.lie && !r.final) {
    return undefined
  }

  const before = openDebt(await read($, ledger)).filter(d => d.termsAt !== game.at).length
  const at = await today($)
  const failed = r.lines.filter(l => !l.pass && !l.soft).map(l => l.term)
  const next = await change($, l => {
    const charged = r.met ? l : addDebt(l, game, failed, at)

    if (!r.final) {
      return charged
    }

    return addGame(r.met ? repay(charged, at) : charged, { at, termsAt: game.at, kept: r.met })
  })
  const after = openDebt(next).length

  return r.final && before !== after ? [before, after] : undefined
}

/** Writes the receipts of the last game into the person's repository. */
export async function writeReceipts($: EngineInterface): Promise<void> {
  const game = await read($, terms)

  if (game === null) {
    return
  }

  const receipt = buildReceipt({
    terms: game,
    rulings: await read($, rulings),
    bets: await read($, bets),
    unbet: (await read($, meta)).unbet,
    ledger: await read($, ledger),
    createdAt: await today($),
  })
  // A folder that cannot be written to must not stop a ruling.
  await $.fs.write(RECEIPTS_JSON, `${JSON.stringify(receipt, null, 2)}\n`).catch(() => undefined)
  await $.fs.write(RECEIPTS_MD, receiptToMarkdown(receipt)).catch(() => undefined)
}

/**
 * `/overrule`: the person overrules the newest broken ruling of the last game.
 * `/overrule debt` clears every open debt, also one from an earlier session.
 */
export async function overruleCmd($: EngineInterface, args: string): Promise<string> {
  const open = openDebt(await read($, ledger)).length

  if (args.trim() === 'debt') {
    if (open === 0) {
      return 'No open debt.'
    }

    const at = await today($)
    await change($, l => forgive(l, at))
    await refreshStatus($)

    return `${VOICE.yields}\n${open === 1 ? '1 debt is' : `${open} debts are`} cleared.`
  }

  const game = await read($, terms)
  // A game that ended with the rules kept has nothing to overrule: its lie was repaid.
  const target =
    game === null || game.state === 'met'
      ? undefined
      : (await read($, rulings)).findLast(r => r.termsId === game.id && !r.met && r.overruled !== true)

  if (game === null || target === undefined) {
    return open === 0
      ? 'No ruling to overrule.'
      : `No ruling to overrule in this session. Open debt: ${open}. Type /overrule debt to clear it.`
  }

  await update($, rulings, list => list.map(r => (r.id === target.id ? { ...r, overruled: true } : r)))
  // The person has decided: the game is over, and it counts as neither kept nor broken.
  await update($, terms, t => (t !== null && t.id === game.id && t.state === 'in play' ? { ...t, state: 'ended' as const } : t))
  const at = await today($)
  await change($, l => dropGame(overrule(l, game.at, at), game.at))
  await refreshStatus($)
  await writeReceipts($)

  return `${VOICE.yields}\nRuling #${target.id} is overruled. The receipt says so.`
}
