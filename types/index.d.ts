export type CommandKind = 'test' | 'build' | 'lint' | 'git' | 'install' | 'other'
export type RecordKind = CommandKind | 'edit' | 'write' | 'tool'
export type ToolRecord = {
  id: number                  // 1, 2, 3 … in the session; shown as "call N"
  turn: number                // counts the person's prompts
  at: number                  // Date.now()
  agentId?: string
  tool: string
  kind: RecordKind
  target: string              // the command, or the file path; '' for other tools
  state: 'clean' | 'failed' | 'unknown'
  output: string              // last 2,000 characters of what the model read
  counts?: { passed: number; failed: number }
  numbers: string[]           // number tokens of the full input and output, newest 150
}
export type FileNet = { asserts: number; tests: number; skips: number; tables: number; removed: string[] }
// one test file now against the summon · removed: up to 3 check lines of the summon that are not in the file now
export type Looked = { net: Record<string, FileNet>; gone: string[] }
// net: per test file of the summon that is still there · gone: test files of the summon that cannot be read now
export type VerdictRun = { record: number; state: ToolRecord['state']; line: string; failed?: number }
export type Terms = {
  id: number; at: number
  verdict: string             // the verdict command, as the person locked it
  also?: string               // the test command inside the package.json script: the same run
  testFiles?: string[]        // the project's test files at the summon; naming all of them is the full run
  demo?: true                 // the demo game: nothing of it goes into the ledger
  startRecord: number         // id of the newest record at the summon
  state: 'in play' | 'met' | 'ended'
  verdictRun?: VerdictRun      // the newest run of the verdict command, in any form
  aloneRun?: VerdictRun        // the newest run of it by itself: only such a run proves rule 1
  startFailed?: number        // tests that already failed in the newest run before the summon
  fixes: number               // presses of Fix this in this game
  lastCodeEdit: number        // record id of the newest code edit; 0 when none
  lastGatedRun: number        // record id of the newest test or build run; 0 when none
  snapshot?: Record<string, TestFile> // the project's test files at the summon; rules 2 to 4 measure them again
  lastReadRun?: number        // the newest test or build run whose result the referee could read
  otherRun?: { record: number; command: string }   // the newest test run that was not the verdict command
}
export type TermId = 'verdict' | 'asserts' | 'tests' | 'skips' | 'numbers'
export type FileCounts = { asserts: number; tests: number; skips: number; tables: number }
export type TestFile = FileCounts & { checks: string[] }   // checks: its check lines, trimmed
export type RulingLine = { term: TermId; pass: boolean; plain: string; detail: string; why?: string; soft?: true; unclear?: true }
// soft: a note, never breaks the game · unclear: the referee could not see, so the rule is neither kept nor broken
export type Ruling = {
  id: number; termsId: number; turn: number; at: number
  lines: RulingLine[]; met: boolean
  fromNowhere: string[]       // numbers of the final message with no source
  saidDone: boolean | null    // true: the AI called the done tool · null: /rule
  final: boolean              // true: issued by /rule, or the terms were met
  lie: boolean                // done over a broken rule the AI did not name
  overruled?: boolean
  debt?: [number, number]     // for a final ruling: open debt before this game, and now
}
export type Bet = {
  id: number; turn: number; at: number
  afterRecord: number         // id of the newest record when the bet was taken
  expect: 'pass' | 'fail'; confidence: number; why: string
  state: 'open' | 'won' | 'lost' | 'void'
  record?: number; line?: string
  you?: 'pass' | 'fail'       // the person's own call on this run, if one was made
}
export type DebtEntry = {
  id: number; at: string; termsAt: number; verdict: string; failed: TermId[]; text: string   // termsAt: the game's Terms.at
  cleared?: { at: string; by: 'proof' | 'person' }
}
export type Ledger = { version: 1; bets: { at: string; confidence: number; won: boolean; youWon?: boolean }[]; games: { at: string; termsAt: number; kept: boolean }[]; debt: DebtEntry[] }
export type Meta = { seq: number; betSeq: number; rulingSeq: number; termsSeq: number; turn: number; denies: number; unbet: number; referee?: number }

declare module 'claude-code' {
  interface PluginState {
    'lie-eater': {
      records: Shaped<ToolRecord[]>; terms: Shaped<Terms | null>; watch: Shaped<Terms | null>; bets: Shaped<Bet[]>
      rulings: Shaped<Ruling[]>; ledger: Shaped<Ledger>; meta: Shaped<Meta>
    }
  }
}
