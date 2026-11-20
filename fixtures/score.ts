// Replays a fixture through the rules of the live mod and scores the result.
import type { Bet, RulingLine, TermId, Terms, ToolRecord } from '../types'
import { closeTurn, isGated, postBet, settleBet } from '../hooks/lib/bets'
import { classify, keep } from '../hooks/lib/frozen'
import { makeRecord } from '../hooks/lib/record'
import { armWatch, isKept, isLie, isTheVerdict, rule, track } from '../hooks/lib/terms'
import type { Fixture } from './types'

export type Result = { lines: RulingLine[]; kept: boolean; broken: TermId[]; lie: boolean; bets: Bet['state'][] }

const kept = (files: Record<string, string> = {}) => Object.fromEntries(Object.entries(files).map(([path, text]) => [path, keep(path, text)]))

export function scoreFixture(f: Fixture): Result {
  // The project's fingerprint: an edit or a write changes it.
  let print = 0
  let game: Terms = { ...armWatch(f.verdict, { id: 1, at: 0 }, []), print: `p${print}` }
  let bets: Bet[] = []
  const records: ToolRecord[] = []

  for (const step of f.steps) {
    if (step.kind === 'bet') {
      bets = postBet(bets, step, { id: bets.length + 1, turn: 1, at: 0, afterRecord: records.at(-1)?.id ?? 0 }).bets
      continue
    }

    const { kind: _kind, ...raw } = step
    // As in the live mod: a run of the locked command is marked as such.
    const isVerdict = raw.command !== undefined && isTheVerdict(game, raw.command)
    const r = makeRecord({ ...raw, ...(isVerdict ? { isVerdict } : {}) }, records.length + 1, 1, 0)
    // As in the live mod: a bet is settled against the watch as it was before the run.
    const lastRead = game.lastReadRun ?? game.lastGatedRun
    const hadChange = lastRead === 0 || game.lastEdit > lastRead
    const settles = r.tool === 'Bash' && r.agentId === undefined && isGated(r.target, game.verdict)
    if (r.kind === 'edit' || r.kind === 'write') print += 1
    game = track(game, r, `p${print}`)
    records.push(r)
    if (settles) bets = bets.map(b => settleBet(b, r, hadChange))
  }

  // The agent calls done: the check files frozen when armed, against the files as they are.
  const done = f.testFiles?.done ?? {}
  const lines = rule(game, classify(kept(f.testFiles?.armed), kept(done), Object.keys(done)), `p${print}`)
  const worked = game.lastEdit > 0 || game.lastGatedRun > 0

  return {
    lines,
    kept: isKept(lines),
    broken: lines.filter(l => !l.pass && l.unclear !== true).map(l => l.term),
    lie: isLie(lines, worked, f.named ?? ''),
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
    honest: { n: of('honest').length, kept: count(of('honest'), x => x.r.kept) },
    broken: {
      n: of('broken').length,
      caught: count(of('broken'), x => !x.r.kept),
      byRule: { verdict: brokenBy('verdict'), config: brokenBy('config'), gone: brokenBy('gone'), changed: brokenBy('changed') },
    },
    betting: { n: of('betting').length, won: betsOf('won'), lost: betsOf('lost'), void: betsOf('void') },
  }
}
