// The values the mod keeps for the session, and where they start.
// They outlive a reload, so each has a shape tag: change the tag when the
// fields change, and a value an earlier version stored is declined.
//
// The engine wants each file that reads or writes state to declare its own
// atoms (a reference with literal names). So the atoms are declared in
// store.ts and referee.ts; this file holds what the two must agree on.
import type { Meta } from '../../types'

export const META_START: Meta = {
  seq: 0,
  betSeq: 0,
  rulingSeq: 0,
  termsSeq: 0,
  turn: 0,
  denies: 0,
  unbet: 0,
  promptNumbers: [],
}

export const SHAPE = {
  records: 'records-1',
  terms: 'terms-1',
  rulings: 'rulings-1',
  bets: 'bets-1',
  meta: 'meta-1',
} as const
