// Replays a fixture through the rules of the live mod and scores the result.
import type { Bet, RulingLine, TermId, ToolRecord } from '../types'
import { closeTurn, isGated, postBet, settleBet } from '../hooks/lib/bets'
import { checkNumbers } from '../hooks/lib/numbers'
import { makeRecord } from '../hooks/lib/record'
import { isKept, rule, summon, track } from '../hooks/lib/terms'
import type { Fixture } from './types'

export type Result = { lines: RulingLine[]; kept: boolean; broken: TermId[]; notes: number; bets: Bet['state'][] }

export function scoreFixture(f: Fixture): Result {
  let game = summon(f.verdict, { id: 1, at: 0 }, [])
  let bets: Bet[] = []
  const records: ToolRecord[] = []

  for (const step of f.steps) {
    if (step.kind === 'bet') {
      bets = postBet(bets, step, { id: bets.length + 1, turn: 1, at: 0, afterRecord: records.at(-1)?.id ?? 0 }).bets
      continue
    }

    const { kind: _kind, ...raw } = step
    const r = makeRecord(raw, records.length + 1, 1, 0)
    // As in the live mod: a bet is settled against the game as it was before the run.
    const hadChange = game.lastGatedRun === 0 || game.lastCodeEdit > game.lastGatedRun
    const settles = r.tool === 'Bash' && r.agentId === undefined && isGated(r.target, game.verdict)
    game = track(game, r)
    records.push(r)
    if (settles) bets = bets.map(b => settleBet(b, r, hadChange))
  }

  const lines = rule(game, checkNumbers(f.answer, records, f.promptNumbers).fromNowhere)

  return {
    lines,
    kept: isKept(lines),
    broken: lines.filter(l => !l.pass && !l.soft).map(l => l.term),
    notes: lines.filter(l => l.soft).length,
    bets: closeTurn(bets).map(b => b.state),
  }
}

const count = <T>(items: readonly T[], is: (item: T) => boolean): number => items.filter(is).length

export function scoreTable(fixtures: readonly Fixture[]) {
  const scored = fixtures.map(f => ({ f, r: scoreFixture(f) }))
  const of = (group: Fixture['group']) => scored.filter(x => x.f.group === group)
  const brokenBy = (term: TermId) => count(of('broken'), x => x.r.broken.includes(term))
  const betsOf = (state: Bet['state']) => of('betting').reduce((n, x) => n + count(x.r.bets, s => s === state), 0)

  return {
    honest: { n: of('honest').length, kept: count(of('honest'), x => x.r.kept), notes: count(of('honest'), x => x.r.notes > 0) },
    broken: {
      n: of('broken').length,
      caught: count(of('broken'), x => !x.r.kept),
      byRule: { verdict: brokenBy('verdict'), asserts: brokenBy('asserts'), tests: brokenBy('tests'), skips: brokenBy('skips') },
      notes: count(of('broken'), x => x.r.notes > 0),
    },
    betting: { n: of('betting').length, won: betsOf('won'), lost: betsOf('lost'), void: betsOf('void') },
  }
}
