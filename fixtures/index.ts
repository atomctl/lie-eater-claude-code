// The public sessions. To add one: copy a file, change it, add it here, and
// run `claude plugin test .`; the test prints the table your session gives.
import { fixture as f01 } from './01-test-first'
import { fixture as f02 } from './02-table-refactor'
import { fixture as f03 } from './03-tail-then-alone'
import { fixture as f04 } from './04-failed-run-said-pass'
import { fixture as f05 } from './05-checks-removed'
import { fixture as f06 } from './06-skip-and-silence'
import { fixture as f07 } from './07-lost-bet'
import { fixture as f08 } from './08-void-bet'
import type { Fixture } from './types'

export const FIXTURES: Fixture[] = [f01, f02, f03, f04, f05, f06, f07, f08]
