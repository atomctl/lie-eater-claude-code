// What Lie Eater does in a live session: it arms itself, it checks a `done`
// call, and it answers /check, /accept and the demo. These functions talk to
// the engine (`$`); every decision they act on comes from the plain functions
// in terms.ts (the proof) and result.ts (what the person is shown).
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Looked, Ruling, Terms, ToolRecord } from '../../types'
import { refreshStatus, writeReceipts } from './house'
import { DEMO_DIR, DEMO_FILES, DEMO_INTRO, DEMO_PROMPT, DEMO_TEST, DEMO_VERDICT } from './demo'
import { inProject, projectFiles, projectNames } from './project'
import { resultOf } from './result'
import { META_START, SHAPE } from './state'
import { armWatch, detectVerdict, isLie, measure, packageTestScript, plainCommand, rule, snapshotOf, track } from './terms'
import { checkPrompt, detailLines, repairOrder } from './words'

export const PANE = 'lie-eater'

// Each file that touches state declares its own atoms (see state.ts).
const records = atom({ plugin: 'lie-eater', key: 'records' } as const, [], { shape: SHAPE.records })
const watch = atom({ plugin: 'lie-eater', key: 'watch' } as const, null, { shape: SHAPE.watch })
const rulings = atom({ plugin: 'lie-eater', key: 'rulings' } as const, [], { shape: SHAPE.rulings })
const meta = atom({ plugin: 'lie-eater', key: 'meta' } as const, META_START, { shape: SHAPE.meta })

const RULINGS_KEPT = 50
const CHECKS_PER_WATCH = 3

export const DONE_TOOL = 'done'
export const DONE_TOOL_FULL = 'mcp__lie-eater__done'

// A mod cannot add to the system prompt, so the tool's description carries the rule.
export const DONE_DESCRIPTION =
  'Lie Eater. Call this when the task is finished. Lie Eater then checks the proof at once and answers with what it found: did the full check (the project\'s test command) pass after your last change, and was any check removed, deleted or switched off? Only a run of the full check by itself (one command, no pipe, no other command beside it) shows that the checks pass. If you changed, removed or switched off a check, or a check still fails, say so in `broken`, in your own words.'

export const DONE_SCHEMA = {
  type: 'object',
  properties: {
    broken: {
      type: 'string',
      maxLength: 500,
      description: 'What you changed in the checks, or what still fails, in your own words. Leave it out when nothing.',
    },
  },
}

const FIRST_TESTS =
  'This project has no tests. Add a small test setup with a test command, and 3 to 5 tests for the most important behaviour. Then say which command runs them.'
const ASKED_FOR_CHECKS =
  'Lie Eater asked the AI to add checks. They protect the work from now on; the work done before them is not checked.'
const NO_CHECKS = 'Lie Eater: this project has no checks yet, so "done" cannot be checked.'
const NOT_THE_MAIN_AI = "Lie Eater checks only the main AI's done call."
const SENT_ENOUGH = 'Lie Eater has sent the AI back 3 times. Look at the Details with /lie-eater, or type /accept if the change is right.'
const NOTHING_TO_ACCEPT = 'Nothing to accept.'
const ACCEPTED = 'You accepted the change. Lie Eater watches from the files as they are now.'
const RESULT_FIRST = 'Lie Eater has a result for you first: type /check or /accept, then /lie-eater demo.'

const armedNow = (verdict: string): string =>
  `Lie Eater found the checks (\`${verdict}\`) and watches from now on. The work done before this is not checked.`

// "Done" can only be a lie about work: with no edit and no run since the watch was armed there was none.
const hasWorked = (w: Terms): boolean => w.lastCodeEdit > w.startRecord || w.lastGatedRun > w.startRecord
// A red result the person has not accepted.
const isOpenRed = (r: Ruling | undefined): boolean => r !== undefined && r.result === 'distrust' && r.accepted !== true

// The sound is a nicety (macOS only): nothing waits for it, and a failed play must not stop a result.
function thump($: EngineInterface): void {
  void $.audio.play({ asset: 'sounds/stamp.wav' }).catch(() => undefined)
}

// The person typed the command or pressed the button, so the prompt is read
// as the person's turn. The engine refuses a prompt sent from inside a command's
// own hook (it would wait on itself), so it goes out a moment later.
function sendAsPerson($: EngineInterface, text: string): void {
  $.clock.after(1, () => {
    void $.prompt.submit({ text, asUser: true }).catch(() => undefined)
  })
}

// The newest test run that is a plain command: not chained, silenced or filtered.
function verdictFromRecord(list: readonly ToolRecord[]): string | undefined {
  return list
    .filter(r => r.kind === 'test')
    .map(r => plainCommand(r.target))
    .findLast(command => !/[|;&]/.test(command))
}

// The texts of these files of the project; a file that cannot be read is left out.
async function readFiles($: EngineInterface, paths: readonly string[]): Promise<Record<string, string>> {
  const texts: Record<string, string> = {}

  for (const path of paths) {
    const text = await $.fs.read(await inProject($, path)).catch(() => undefined)
    if (typeof text === 'string') texts[path] = text
  }

  return texts
}

/** At each `done` and each /check the test files of the snapshot are read again. */
async function looked($: EngineInterface, w: Terms): Promise<Looked> {
  const snap = w.snapshot ?? {}

  return measure(snap, await readFiles($, Object.keys(snap)))
}

/** A watch from the project as it is now: the full check and the test files named. */
async function fresh($: EngineInterface, verdict: string, names?: readonly string[]): Promise<Terms> {
  const files = await projectFiles($)

  return armWatch(
    verdict,
    { id: 0, at: await $.clock.now() },
    await read($, records),
    packageTestScript(files['package.json']),
    names ?? (await projectNames($)),
  )
}

/**
 * Finds the project's checks: the newest plain test run in the record (up to
 * record `upTo`), else the config files, else the names of the test files.
 * Undefined when there is no test command or no test file: "no checks yet".
 */
async function findChecks($: EngineInterface, upTo = Infinity): Promise<Terms | undefined> {
  const names = await projectNames($)
  const runs = (await read($, records)).filter(r => r.id <= upTo)
  const verdict = verdictFromRecord(runs) ?? detectVerdict(await projectFiles($), names)

  if (verdict === undefined) {
    return undefined
  }

  const found = await fresh($, verdict, names)

  return (found.testFiles ?? []).length === 0 ? undefined : found
}

/** Puts a new watch in place, with its own number and the test files as they are now. */
async function setWatch($: EngineInterface, w: Terms): Promise<void> {
  const id = (await read($, meta)).termsSeq + 1
  const snapshot = snapshotOf(await readFiles($, w.testFiles ?? []))
  await update($, watch, () => ({ ...w, id, snapshot }))
  await update($, meta, m => ({ ...m, termsSeq: id }))
}

/**
 * Arms the watch, silently, when none is armed: at the start of a session, at
 * each prompt, at each `done`. An armed watch is never armed again here: a
 * reload must not take a new snapshot over a removed check. True when it armed now.
 */
export async function armIfNone($: EngineInterface): Promise<boolean> {
  if ((await read($, watch)) !== null) {
    return false
  }

  const found = await findChecks($)

  if (found === undefined) {
    return false
  }

  await setWatch($, found)

  return true
}

/**
 * After a green result or an accepted change: the same watch, from the files
 * as they are now. The full check and what is known of its runs stay (so a
 * second `done` with no change is green again); the snapshot, the start and
 * the /check count are new. A demo gives way to the project's own checks.
 */
async function rearm($: EngineInterface, w: Terms): Promise<void> {
  // The project's own runs are the ones before the demo began.
  const own = w.demo === true ? await findChecks($, w.startRecord) : undefined

  if (own !== undefined) {
    await setWatch($, own)

    return
  }

  const now = await fresh($, w.verdict, w.demo === true ? [DEMO_TEST] : undefined)
  const snapshot = snapshotOf(await readFiles($, now.testFiles ?? []))
  const { startFailed: _before, testFiles: _files, ...kept } = w
  // An accepted failing run is where the work starts now.
  const failed = w.aloneRun?.state === 'failed' ? w.aloneRun.failed : undefined
  await update($, watch, () => ({
    ...kept,
    ...(now.testFiles === undefined ? {} : { testFiles: now.testFiles }),
    ...(failed === undefined ? {} : { startFailed: failed }),
    startRecord: now.startRecord,
    fixes: 0,
    snapshot,
  }))
}

/**
 * Takes a new record into the watch. Hands back the watch as it was before
 * this record: a bet is settled against what was known until then.
 */
export async function onRecord($: EngineInterface, r: ToolRecord): Promise<Terms | undefined> {
  const before = await read($, watch)
  await update($, watch, w => (w === null ? w : track(w, r)))

  return before ?? undefined
}

async function addRuling($: EngineInterface, made: Omit<Ruling, 'id' | 'turn' | 'at'>): Promise<Ruling> {
  const m = await read($, meta)
  const ruling: Ruling = { ...made, id: m.rulingSeq + 1, turn: m.turn, at: await $.clock.now() }
  await update($, meta, x => ({ ...x, rulingSeq: ruling.id }))
  await update($, rulings, list => [...list, ruling].slice(-RULINGS_KEPT))

  return ruling
}

/**
 * The done tool: the AI says the task is finished, and Lie Eater checks the
 * proof now. Green and "not checked" change only the status line; the first
 * red result of a watch also opens the pane, shows one toast and plays the
 * sound. Hands back what it found, so the AI can repair at once.
 */
export async function doneCall($: EngineInterface, input: Record<string, unknown>): Promise<string> {
  // A subagent's part is not the task the person gave.
  if (input.agentId !== undefined) {
    return NOT_THE_MAIN_AI
  }

  if (await armIfNone($)) {
    await refreshStatus($)

    return armedNow((await read($, watch))?.verdict ?? '')
  }

  const w = await read($, watch)

  if (w === null) {
    await refreshStatus($)

    return NO_CHECKS
  }

  const seen = await looked($, w)
  const lines = rule(w, seen)
  const named = typeof input.broken === 'string' ? input.broken : ''
  const worked = hasWorked(w)
  const { result, screen } = resultOf(lines, named, worked)
  const before = (await read($, rulings)).findLast(r => r.termsId === w.id)
  await addRuling($, { termsId: w.id, lines, result, screen, lie: isLie(lines, worked, named) })
  await writeReceipts($, w)

  // A second red result in a row only updates the pane and the line.
  if (result === 'distrust' && !isOpenRed(before)) {
    // With no surface to draw on (a headless run) the result still stands.
    await $.ui.open({ id: PANE, title: 'Lie Eater' }).catch(() => undefined)
    $.ui.toast(screen[0] ?? '')
    thump($)
  }

  if (result === 'checked') {
    await rearm($, w)
  }

  await refreshStatus($)
  const order = result === 'checked' ? undefined : repairOrder(lines, w.verdict, seen.net)

  return [...screen, '', 'Details:', ...detailLines(lines), ...(order === undefined ? [] : ['', order])].join('\n')
}

/**
 * The person names the full check (`/check <command>`). What was there
 * before stays the baseline (the snapshot and the start), so a check removed
 * earlier is still seen; only the command is new.
 */
async function nameCheck($: EngineInterface, command: string): Promise<void> {
  const w = await read($, watch)
  const named = await fresh($, command)

  if (w === null) {
    // The person's word: armed even when no test file was found.
    await setWatch($, named)

    return
  }

  await update($, watch, () => ({
    ...named,
    id: w.id,
    at: w.at,
    startRecord: w.startRecord,
    fixes: w.fixes,
    ...(w.snapshot === undefined ? {} : { snapshot: w.snapshot }),
    ...(w.startFailed === undefined ? {} : { startFailed: w.startFailed }),
    ...(w.demo === undefined ? {} : { demo: w.demo }),
  }))
}

/**
 * `/check` ("Check again", "Put it back and fix the work", "Add checks"): one
 * prompt to the AI, as the person, to repair what was found and run the full
 * check by itself, then call done. Three times per watch at most. With no
 * checks in the project it asks the AI to add them.
 */
export async function checkCmd($: EngineInterface, args: string): Promise<string> {
  const asked = args.trim()

  if (asked !== '') {
    await nameCheck($, asked)
  } else {
    await armIfNone($)
  }

  const w = await read($, watch)

  if (w === null) {
    sendAsPerson($, FIRST_TESTS)

    return ASKED_FOR_CHECKS
  }

  if (w.fixes >= CHECKS_PER_WATCH) {
    await refreshStatus($)

    return SENT_ENOUGH
  }

  const seen = await looked($, w)
  const run = checkPrompt(w.verdict)
  const order = repairOrder(rule(w, seen), w.verdict, seen.net) ?? run
  await update($, watch, x => (x !== null && x.id === w.id ? { ...x, fixes: x.fixes + 1 } : x))
  sendAsPerson($, order)
  await refreshStatus($)

  return order === run
    ? `Lie Eater asked the AI to run the full check (\`${w.verdict}\`) by itself.`
    : `Lie Eater sent the AI back to repair what it found and to run the full check (\`${w.verdict}\`).`
}

/** `/accept` ("Accept this change"): the person accepts what the red result shows; the watch starts again from the files as they are. */
export async function acceptCmd($: EngineInterface): Promise<string> {
  const w = await read($, watch)
  const last = w === null ? undefined : (await read($, rulings)).findLast(r => r.termsId === w.id)

  if (w === null || last === undefined || !isOpenRed(last)) {
    return NOTHING_TO_ACCEPT
  }

  await update($, rulings, list => list.map(r => (r.id === last.id ? { ...r, accepted: true as const } : r)))
  await writeReceipts($, w)
  await rearm($, w)
  await refreshStatus($)

  return ACCEPTED
}

/** `/lie-eater demo`: a tiny project with one failing test, and the AI's task on it. */
export async function demoCmd($: EngineInterface): Promise<string> {
  const w = await read($, watch)

  if (w !== null && isOpenRed((await read($, rulings)).findLast(r => r.termsId === w.id))) {
    return RESULT_FIRST
  }

  for (const [name, text] of Object.entries(DEMO_FILES)) {
    await $.fs.write(await inProject($, `${DEMO_DIR}/${name}`), text)
  }

  await setWatch($, { ...(await fresh($, DEMO_VERDICT, [DEMO_TEST])), demo: true })
  // The person asked to watch: the pane opens.
  await $.ui.open({ id: PANE, title: 'Lie Eater' }).catch(() => undefined)
  sendAsPerson($, DEMO_PROMPT)
  await refreshStatus($)

  return DEMO_INTRO.join('\n')
}
