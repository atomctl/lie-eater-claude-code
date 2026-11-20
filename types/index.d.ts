export type CommandKind = 'test' | 'build' | 'lint' | 'git' | 'install' | 'other'
export type RecordKind = CommandKind | 'edit' | 'write' | 'tool'
/** Counts in the old and the new text of one test-file edit: [old, new]. */
export type TestEdit = { asserts: [number, number]; tests: [number, number]; skips: [number, number]; tables: [number, number]; lines: string[] }   // lines: up to 3 assertion lines that are in the old text and not in the new
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
  testEdit?: TestEdit         // only for an edit or write of a test file
  numbers: string[]           // number tokens of the full input and output, newest 150
}
export type FileNet = { asserts: number; tests: number; skips: number; tables: number; removed: string[] }
export type Terms = {
  id: number; at: number
  verdict: string             // the verdict command, as the person locked it
  startRecord: number         // id of the newest record at the summon
  state: 'in play' | 'met' | 'ended'
  verdictRun?: { record: number; state: ToolRecord['state']; line: string; failed?: number }
  startFailed?: number        // tests that already failed in the newest run before the summon
  fixes: number               // presses of Fix this in this game
  lastCodeEdit: number        // record id of the newest code edit; 0 when none
  lastGatedRun: number        // record id of the newest test or build run; 0 when none
  net: Record<string, FileNet> // per test file, summed over its edits since the summon
  deleted: string[]           // test files removed with rm or git rm
}
export type TermId = 'verdict' | 'asserts' | 'tests' | 'skips' | 'numbers'
export type RulingLine = { term: TermId; pass: boolean; plain: string; detail: string; why?: string; soft?: true }   // soft: a note, never breaks the game
export type Ruling = {
  id: number; termsId: number; turn: number; at: number
  lines: RulingLine[]; met: boolean
  saidDone: boolean | null    // null: the model call gave no answer
  final: boolean              // true: issued by /rule, or the terms were met
  lie: boolean                // saidDone and not met
  overruled?: boolean
}
export type Bet = {
  id: number; turn: number; at: number
  afterRecord: number         // id of the newest record when the bet was taken
  expect: 'pass' | 'fail'; confidence: number; why: string
  state: 'open' | 'won' | 'lost' | 'void'
  record?: number; line?: string
}
export type DebtEntry = {
  id: number; at: string; termsAt: number; verdict: string; failed: TermId[]; text: string   // termsAt: the game's Terms.at
  cleared?: { at: string; by: 'proof' | 'person' }
}
export type Ledger = { version: 1; bets: { at: string; confidence: number; won: boolean }[]; games: { at: string; termsAt: number; kept: boolean }[]; debt: DebtEntry[] }
export type Meta = { seq: number; betSeq: number; rulingSeq: number; termsSeq: number; turn: number; denies: number; unbet: number; promptNumbers: string[]; note?: string }

declare module 'claude-code' {
  interface PluginState {
    'lie-eater': {
      records: Shaped<ToolRecord[]>; terms: Shaped<Terms | null>; bets: Shaped<Bet[]>
      rulings: Shaped<Ruling[]>; ledger: Shaped<Ledger>; meta: Shaped<Meta>
    }
  }
}
