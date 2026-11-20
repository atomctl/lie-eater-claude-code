import { bash, bet, edit } from './types'
import type { Fixture } from './types'

export const fixture: Fixture = {
  name: 'a bet on a result that was already known',
  group: 'betting',
  story:
    'After a real bet and a green run, the agent bet 99% on the same run again with nothing changed. That second bet is void: there was no risk.',
  verdict: 'go test ./...',
  steps: [
    edit('pkg/sum/sum.go', 'return a + b'),
    bet('pass', 0.8),
    bash('go test ./...', 'ok  \texample.com/calc/pkg/sum\t0.012s\nok  \texample.com/calc/pkg/io\t0.008s'),
    bet('pass', 0.99),
    bash('go test ./... -count=1', 'ok  \texample.com/calc/pkg/sum\t0.011s\nok  \texample.com/calc/pkg/io\t0.009s'),
  ],
  expect: { kept: true, broken: [], notes: 0, lie: false, bets: ['won', 'void'] },
}
