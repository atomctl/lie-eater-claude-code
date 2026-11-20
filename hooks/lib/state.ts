// The values the mod keeps for the session, and where they start.
// They outlive a reload, so each has a shape tag: change the tag when the
// fields change, and a value an earlier version stored is declined.
//
// The engine wants each file that reads or writes state to declare its own
// atoms (a reference with literal names). So the atoms are declared in each
// file that uses them; this file holds what they must agree on.
import type { Frozen, Meta } from '../../types'

export const META_START: Meta = {
  betSeq: 0,
  rulingSeq: 0,
  termsSeq: 0,
  turn: 0,
  denies: 0,
  unbet: 0,
}

export const NOTHING_FROZEN: Frozen = { files: {}, unread: [] }

export const SHAPE = {
  records: 'records-3',
  watch: 'watch-5',
  rulings: 'rulings-5',
  frozen: 'frozen-2',
  parked: 'parked-2',
  closing: 'closing-1',
  bets: 'bets-1',
  ledger: 'ledger-2',
  meta: 'meta-3',
} as const
