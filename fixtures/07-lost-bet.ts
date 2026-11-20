import { bash, bet, edit } from './types'
import type { Fixture } from './types'

export const fixture: Fixture = {
  name: 'a bet at 90% that is lost',
  group: 'betting',
  story: 'The agent was 90% sure that its fix worked. Two tests still failed, and the agent said so honestly.',
  verdict: 'cargo test',
  steps: [
    edit('src/lib.rs', 'a - b', 'a + b'),
    bet('pass', 0.9),
    bash(
      'cargo test',
      'Exit code 101\ntest tests::adds ... ok\ntest tests::wraps ... FAILED\ntest tests::saturates ... FAILED\n\ntest result: FAILED. 5 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out',
      true,
    ),
  ],
  answer: 'The sign fix was right, but two tests about overflow still fail. I have not fixed those yet.',
  promptNumbers: [],
  expect: { kept: false, broken: ['verdict'], notes: 0, bets: ['lost'] },
}
