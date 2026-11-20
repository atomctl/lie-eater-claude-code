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
// One check file as it was frozen: its text, or (when big) a hash of it with its length.
export type Kept = { text: string } | { hash: string }
// The check files frozen when the watch was armed. unread: files of the frozen set that could not be read then.
export type Frozen = { files: Record<string, Kept>; unread: string[] }
// What became of one frozen check file, or a new file that decides how checks run.
// n: lines changed · lost: up to 5 original lines that are gone (shown in the pane only)
export type Change = { file: string; how: 'config' | 'gone' | 'changed' | 'only'; n?: number; lost?: string[] }
// print: the project's fingerprint when the run started; absent when it could not be taken
export type VerdictRun = { record: number; state: ToolRecord['state']; line: string; failed?: number; print?: string }
// A test run that is not the full check: with extra options, inside a longer command, another command, or in another folder.
export type Try = { record: number; how: 'extra' | 'chained' | 'other' | 'elsewhere'; command: string }
// The watch: what Lie Eater checks "done" against. Armed by itself; armed again
// (same id, new frozen set, new start) after a green result or an accepted change.
export type Terms = {
  id: number; at: number
  verdict: string             // the full check: the project's test command
  also?: string               // the test command inside the package.json script: the same run
  demo?: true                 // the demo: its bets do not go into the ledger
  root?: string               // the folder the watch walks, inside the project; absent: the project itself
  print?: string              // the project's fingerprint when armed; absent when it is too large to read fully
  startRecord: number         // id of the newest record when armed
  fullRun?: VerdictRun        // the newest run of the full check: only it proves that the checks pass
  tried?: Try                 // the newest test run that was not the full check
  startFailed?: number        // checks that already failed before any change of the project
  fixes: number               // prompts sent by /check since armed (3 at most)
  lastEdit: number            // record id of the newest edit or write; 0 when none
  lastGatedRun: number        // record id of the newest test or build run; 0 when none
  lastReadRun?: number        // the newest test or build run whose result could be read
  unproven?: true             // the person accepted a change: no full run stands until a new one passes
}
export type TermId = 'verdict' | 'config' | 'gone' | 'changed' | 'only' | 'unread'
export type RulingLine = {
  term: TermId; pass: boolean; plain: string; detail: string; why?: string; unclear?: true
  file?: string; n?: number   // the check file a line is about, and how many lines changed
}
// unclear: it could not be seen, so the line is neither kept nor broken
export type Result = 'checked' | 'distrust' | 'unchecked'
export type Ruling = {
  id: number; termsId: number; turn: number; at: number
  lines: RulingLine[]
  result: Result
  screen: string[]            // what the person reads: at most 3 lines
  lie: boolean                // "done" over a breach the AI did not name
  accepted?: true             // the person accepted the change (/accept)
  lost?: Record<string, string[]> // per changed check file, original lines that are gone: the pane only, never the receipts
  print?: string              // the project's fingerprint measured for this result: /accept takes nothing later
  added?: string[]            // a green result only: the check files new since the watch was armed; empty: no new check
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
// The project's watch and its frozen files, kept aside while the demo runs on a watch of its own.
export type Parked = { watch: Terms; frozen: Frozen }

declare module 'claude-code' {
  interface PluginState {
    'lie-eater': {
      records: Shaped<ToolRecord[]>; watch: Shaped<Terms | null>; bets: Shaped<Bet[]>
      rulings: Shaped<Ruling[]>; ledger: Shaped<Ledger>; meta: Shaped<Meta>
      frozen: Shaped<Frozen>; parked: Shaped<Parked | null>
      closing: Shaped<string[] | null>   // the demo's closing lines, shown in the pane until the next result
    }
  }
}
