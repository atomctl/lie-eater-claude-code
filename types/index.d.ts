export type CommandKind = 'test' | 'build' | 'lint' | 'git' | 'install' | 'other'
export type RecordKind = CommandKind | 'edit' | 'write' | 'tool'
export type ToolRecord = {
  id: number                  // 1, 2, 3 … in the session; shown as "#N"
  turn: number                // counts the person's prompts
  at: number                  // Date.now()
  agentId?: string
  tool: string
  kind: RecordKind
  target: string              // the command, or the file path; '' for other tools
  state: 'clean' | 'failed' | 'unknown'
  output: string              // last 2,000 characters of what the model read
  counts?: { passed: number; failed: number }
}
export type FileNet = { asserts: number; tests: number; skips: number; tables: number; removed: string[] }
// one test file now against the snapshot · removed: up to 3 check lines of the snapshot that are not in the file now
export type Looked = { net: Record<string, FileNet>; gone: string[] }
// net: per test file of the snapshot that is still there · gone: test files of the snapshot that cannot be read now
export type VerdictRun = { record: number; state: ToolRecord['state']; line: string; failed?: number }
// The watch: what Lie Eater checks "done" against. Armed by itself; armed again
// (same id, new snapshot, new start) after a green result or an accepted change.
export type Terms = {
  id: number; at: number
  verdict: string             // the full check: the project's test command
  also?: string               // the test command inside the package.json script: the same run
  testFiles?: string[]        // the project's test files when armed; naming all of them is the full run
  demo?: true                 // the demo: its bets do not go into the ledger
  startRecord: number         // id of the newest record when armed
  verdictRun?: VerdictRun      // the newest run of the full check, in any form
  aloneRun?: VerdictRun        // the newest run of it by itself: only such a run proves that the checks pass
  startFailed?: number        // checks that already failed before any code change
  fixes: number               // prompts sent by /check since armed (3 at most)
  lastCodeEdit: number        // record id of the newest code edit; 0 when none
  lastGatedRun: number        // record id of the newest test or build run; 0 when none
  snapshot?: Record<string, TestFile> // the project's test files when armed; measured again at each done
  lastReadRun?: number        // the newest test or build run whose result could be read
  otherRun?: { record: number; command: string }   // the newest test run that was not the full check
}
export type TermId = 'verdict' | 'asserts' | 'tests' | 'skips'
export type FileCounts = { asserts: number; tests: number; skips: number; tables: number }
export type TestFile = FileCounts & { checks: string[] }   // checks: its check lines, trimmed
export type RulingLine = {
  term: TermId; pass: boolean; plain: string; detail: string; why?: string; soft?: true; unclear?: true
  file?: string; n?: number   // the test file a line is about, and how many checks or tests
}
// soft: a note, never breaks the result · unclear: it could not be seen, so the line is neither kept nor broken
export type Result = 'checked' | 'distrust' | 'unchecked'
export type Ruling = {
  id: number; termsId: number; turn: number; at: number
  lines: RulingLine[]
  result: Result
  screen: string[]            // what the person reads: at most 3 lines
  lie: boolean                // "done" over a breach the AI did not name
  accepted?: true             // the person accepted the change (/accept)
}
export type Bet = {
  id: number; turn: number; at: number
  afterRecord: number         // id of the newest record when the bet was taken
  expect: 'pass' | 'fail'; confidence: number; why: string
  state: 'open' | 'won' | 'lost' | 'void'
  record?: number; line?: string
  you?: 'pass' | 'fail'       // the person's own call on this run, if one was made
}
export type Ledger = { version: 1; bets: { at: string; confidence: number; won: boolean; youWon?: boolean }[] }
export type Meta = { betSeq: number; rulingSeq: number; termsSeq: number; turn: number; denies: number; unbet: number }

declare module 'claude-code' {
  interface PluginState {
    'lie-eater': {
      records: Shaped<ToolRecord[]>; watch: Shaped<Terms | null>; bets: Shaped<Bet[]>
      rulings: Shaped<Ruling[]>; ledger: Shaped<Ledger>; meta: Shaped<Meta>
    }
  }
}
