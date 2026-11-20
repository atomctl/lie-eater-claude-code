// What Lie Eater does in a live session: it arms itself, it checks a `done`
// call, and it answers /check, /accept and the demo. These functions talk to
// the engine (`$`); every decision they act on comes from the plain functions
// in terms.ts (the proof) and result.ts (what the person is shown).
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Change, Frozen, Ruling, Terms, ToolRecord } from '../../types'
import { refreshStatus, writeReceipts } from './house'
import { DEMO_DIR, DEMO_FILES, DEMO_INTRO, DEMO_PROMPT, DEMO_VERDICT, demoEnd } from './demo'
import { classify, isFrozen, keep, newChecks } from './frozen'
import { inProject, projectFiles, projectRoot, walk } from './project'
import type { Walked } from './project'
import { TEST_SOURCE, isTestFile } from './record'
import { resultOf } from './result'
import { META_START, NOTHING_FROZEN, SHAPE } from './state'
import { alsoOf, armWatch, cannotCheck, detectVerdict, howRun, isLie, isPlainRun, packageShortcut, plainCommand, rule, track } from './terms'
import { FROZEN, checkPrompt, detailLines, repairOrder } from './words'

export const PANE = 'lie-eater'

// Each file that touches state declares its own atoms (see state.ts).
const records = atom({ plugin: 'lie-eater', key: 'records' } as const, [], { shape: SHAPE.records })
const watch = atom({ plugin: 'lie-eater', key: 'watch' } as const, null, { shape: SHAPE.watch })
const rulings = atom({ plugin: 'lie-eater', key: 'rulings' } as const, [], { shape: SHAPE.rulings })
const meta = atom({ plugin: 'lie-eater', key: 'meta' } as const, META_START, { shape: SHAPE.meta })
const frozen = atom({ plugin: 'lie-eater', key: 'frozen' } as const, NOTHING_FROZEN, { shape: SHAPE.frozen })
const parked = atom({ plugin: 'lie-eater', key: 'parked' } as const, null, { shape: SHAPE.parked })
const closing = atom({ plugin: 'lie-eater', key: 'closing' } as const, null, { shape: SHAPE.closing })

const RULINGS_KEPT = 50
const CHECKS_PER_WATCH = 3
// The most text the frozen set keeps in all; past it a check file is kept as a hash.
const TEXT_KEPT_IN_ALL = 2_000_000

export const DONE_TOOL = 'done'
export const DONE_TOOL_FULL = 'mcp__lie-eater__done'

// A mod cannot add to the system prompt, so the tool's description carries the rule.
export const DONE_DESCRIPTION =
  'Lie Eater. Call this when the task is finished. Lie Eater then checks the proof at once and answers with what it found: did the full check (the project\'s test command) pass on the files as they are now, and was a check file changed, moved or deleted, or a file that decides how the checks run? Only a run of the full check by itself, exactly as it is (one command, no pipe, no other command beside it, no extra options), shows that the checks pass. If you changed a check, or a check still fails, say so in `broken`, in your own words. ' + FROZEN

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
const SENT_ENOUGH = 'Lie Eater has sent the AI back 3 times. Look at the Details with /lie-eater details, or type /accept if the change is right.'
const NOTHING_TO_ACCEPT = 'Nothing to accept.'
const ACCEPTED = 'You accepted the change. Lie Eater watches from the files as they are now.'
const RESULT_FIRST = 'Lie Eater has a result for you first: type /check or /accept, then /lie-eater demo.'
const CHANGED_SINCE = 'The files changed since that result. Wait for the next result, then accept.'
const NOT_READ = 'Lie Eater could not read the project fully, so it cannot tell what you would accept.'
// Under a green result with no new check file: advice to the AI, not a refusal.
const ADD_A_CHECK = 'If this change added or changed behaviour, add a check for it in a new file and call done again.'

const NO_CHECK_RUN = (command: string, flag: string): string =>
  `Lie Eater cannot use \`${command}\` as the full check: with \`${flag}\` it runs no check.`
const DEMO_NOT_OURS = `Lie Eater did not make the demo: ${DEMO_DIR} holds files the demo did not write. Move them away, then type /lie-eater demo again.`

const armedNow = (verdict: string): string =>
  `Lie Eater found the checks (\`${verdict}\`) and watches from now on. The work done before this is not checked.`

// "Done" can only be a lie about work: with no change and no run since the watch was armed there was none.
const hasWorked = (w: Terms, print: string | undefined): boolean =>
  w.lastEdit > w.startRecord || w.lastGatedRun > w.startRecord || print !== w.print
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

// The newest test run that would be a full check by itself: a plain runner, allowed flags only.
function verdictFromRecord(list: readonly ToolRecord[]): string | undefined {
  const run = list.findLast(r => r.kind === 'test' && isPlainRun(r.target))

  return run === undefined ? undefined : plainCommand(run.target)
}

/** These files of the project as the frozen set keeps them; a file that cannot be read is named in `unread`. */
async function freeze($: EngineInterface, paths: readonly string[]): Promise<Frozen> {
  const files: Frozen['files'] = {}
  const unread: string[] = []
  let room = TEXT_KEPT_IN_ALL

  for (const path of paths) {
    const text = await $.fs.read(await inProject($, path)).catch(() => undefined)

    if (typeof text !== 'string') {
      unread.push(path)
      continue
    }

    const kept = keep(path, text, room)
    if ('text' in kept) room -= kept.text.length
    files[path] = kept
  }

  return { files, unread }
}

type Look = { walked: Walked; now: Frozen; changes: Change[] }

/** At each `done` and `/check`: the project walked again, and every frozen check file (and every new one) read as it is now. */
async function look($: EngineInterface, w: Terms): Promise<Look> {
  const walked = await walk($, w.root)
  const was = await read($, frozen)
  const paths = [...new Set([...Object.keys(was.files), ...walked.names.filter(isFrozen)])]
  const got = await freeze($, paths)
  // A frozen file that is not there now is gone, not unread.
  const now = { files: got.files, unread: got.unread.filter(path => walked.names.includes(path)) }

  return { walked, now, changes: classify(was.files, now.files, walked.names, [...was.unread, ...now.unread]) }
}

// Per changed check file, its original lines that are gone: for the pane only.
function lostOf(changes: readonly Change[]): Ruling['lost'] {
  const lost = changes.filter(c => (c.lost ?? []).length > 0).map(c => [c.file, c.lost ?? []] as const)

  return lost.length === 0 ? undefined : Object.fromEntries(lost)
}

/** A watch for this full check, from the record as it is now. */
async function fresh($: EngineInterface, verdict: string): Promise<Terms> {
  const files = await projectFiles($)

  return armWatch(verdict, { id: 0, at: await $.clock.now() }, await read($, records), packageShortcut(files['package.json']))
}

/**
 * Finds the project's checks: the newest plain test run in the record, else
 * the config files, else the names of the test files.
 * Undefined when there is no test command or no test file: "no checks yet".
 */
async function findChecks($: EngineInterface): Promise<{ terms: Terms; walked: Walked } | undefined> {
  const walked = await walk($)
  const verdict = verdictFromRecord(await read($, records)) ?? detectVerdict(await projectFiles($), walked.names)

  if (verdict === undefined || !walked.names.some(name => isTestFile(name) && TEST_SOURCE.test(name))) {
    return undefined
  }

  return { terms: await fresh($, verdict), walked }
}

/** Puts a new watch in place, with its own number: the check files frozen and the fingerprint as the walk found them. */
async function setWatch($: EngineInterface, w: Terms, walked: Walked): Promise<void> {
  const id = (await read($, meta)).termsSeq + 1
  const set = await freeze($, walked.names.filter(isFrozen))
  const { print: _old, ...rest } = w
  await update($, frozen, () => set)
  await update($, watch, () => ({ ...rest, id, ...(walked.print === undefined ? {} : { print: walked.print }) }))
  await update($, meta, m => ({ ...m, termsSeq: id }))
}

/**
 * Arms the watch, silently, when none is armed: at the start of a session, at
 * each prompt, at each `done`. An armed watch is never armed again here: a
 * reload must not freeze a check file that was changed. True when it armed now.
 */
export async function armIfNone($: EngineInterface): Promise<boolean> {
  if ((await read($, watch)) !== null) {
    return false
  }

  const found = await findChecks($)

  if (found === undefined) {
    return false
  }

  await setWatch($, found.terms, found.walked)

  return true
}

/**
 * After a green result (`accepted` false: the files exactly as they were
 * measured for it, and the full run stands) or an accepted change (`accepted`
 * true: the files as they are now, and the full run is void until a new one
 * passes). The watch keeps its number. A demo gives way to the project's own
 * watch, kept aside while the demo ran.
 */
async function rearm($: EngineInterface, w: Terms, at: { walked: Walked; set: Frozen }, accepted: boolean): Promise<void> {
  const own = w.demo === true ? await read($, parked) : null

  if (own !== null) {
    await update($, frozen, () => own.frozen)
    await update($, watch, () => own.watch)
    await update($, parked, () => null)

    return
  }

  const { startFailed: _before, unproven: _unproven, print: _print, fullRun, tried, also: was, ...kept } = w
  // An accepted failing run is where the work starts now.
  const failed = accepted && fullRun?.state === 'failed' ? fullRun.failed : undefined
  // An accepted change can be a new test script: the command behind `npm test` is found again.
  const also = accepted ? alsoOf(w.verdict, packageShortcut((await projectFiles($))['package.json'])) : was
  const startRecord = (await read($, records)).at(-1)?.id ?? 0
  await update($, frozen, () => at.set)
  await update($, watch, () => ({
    ...kept,
    ...(also === undefined ? {} : { also }),
    ...(accepted ? { unproven: true as const } : { ...(fullRun === undefined ? {} : { fullRun }), ...(tried === undefined ? {} : { tried }) }),
    ...(at.walked.print === undefined ? {} : { print: at.walked.print }),
    ...(failed === undefined ? {} : { startFailed: failed }),
    startRecord,
    fixes: 0,
  }))
}

/**
 * Before a run of the full check by itself: the project's fingerprint, so
 * that a change during or after it is seen, and whether the shell stands
 * outside the folder the watch walks. When the engine names no folder, the run counts.
 */
export async function beforeRun($: EngineInterface, input: Record<string, unknown>): Promise<{ print?: string; elsewhere: boolean } | undefined> {
  const w = await read($, watch)

  if (w === null || input.tool !== 'Bash' || typeof input.command !== 'string' || howRun(w, input.command) !== 'full') {
    return undefined
  }

  // One folder can be spelled two ways (`/tmp` and `/private/tmp` on a Mac; a slash at the end).
  const spelled = (path: string): string => path.replace(/\/+$/, '').replace(/^\/private(?=\/)/, '')
  const cwd = spelled(await $.session.cwd().catch(() => ''))
  const elsewhere = cwd !== '' && (await projectRoot($)) !== '' && cwd !== spelled(await inProject($, w.root))
  const { print } = await walk($, w.root)

  return { ...(print === undefined ? {} : { print }), elsewhere }
}

/**
 * Takes a new record into the watch, with what `beforeRun` saw as the run
 * started. Hands back the watch as it was before this record: a bet is
 * settled against what was known until then.
 */
export async function onRecord($: EngineInterface, r: ToolRecord, at?: { print?: string; elsewhere: boolean }): Promise<Terms | undefined> {
  const before = await read($, watch)
  await update($, watch, w => (w === null ? w : track(w, r, at?.print, at?.elsewhere)))

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
 * proof now. Green and "not checked" change only the status line; a red
 * result also opens the pane, and the first in a row shows one toast and plays
 * the sound. Hands back what it found, so the AI can repair at once.
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

  const seen = await look($, w)
  const was = await read($, frozen)
  // Unread when armed, or unread now: either way that file cannot be compared.
  const lines = rule(w, seen.changes, seen.walked.print, [...new Set([...was.unread, ...seen.now.unread])])
  const named = typeof input.broken === 'string' ? input.broken : ''
  const worked = hasWorked(w, seen.walked.print)
  const { result, screen, added } = resultOf(lines, named, worked, newChecks(was, seen.walked.names, seen.now.files))
  const earlier = (await read($, rulings)).filter(r => r.termsId === w.id)
  const before = earlier.at(-1)
  const lost = lostOf(seen.changes)
  const print = seen.walked.print
  await addRuling($, { termsId: w.id, lines, result, screen, ...(added === undefined ? {} : { added }), lie: isLie(lines, worked, named), ...(lost === undefined ? {} : { lost }), ...(print === undefined ? {} : { print }) })
  await writeReceipts($, w)

  // Every red result opens the pane (the person's prompt closes it); only the first in a row shows a toast and plays the sound.
  if (result === 'distrust') {
    // With no surface to draw on (a headless run) the result still stands.
    await $.ui.open({ id: PANE, title: 'Lie Eater' }).catch(() => undefined)

    if (!isOpenRed(before)) {
      $.ui.toast(screen[0] ?? '')
      thump($)
    }
  }

  // The demo's closing lines stand in the pane until the next result, or until the pane closes.
  const end = w.demo === true && result === 'checked' ? demoEnd(earlier) : undefined
  await update($, closing, () => end ?? null)
  // The person may have typed and so closed the pane: the demo's end must be seen.
  if (end !== undefined) await $.ui.open({ id: PANE, title: 'Lie Eater' }).catch(() => undefined)

  if (result === 'checked') {
    await rearm($, w, { walked: seen.walked, set: seen.now }, false)
  }

  await refreshStatus($)
  // The demo's folder holds only the demo's files: no advice to add one there.
  const order = result !== 'checked' ? repairOrder(lines, w.verdict) : added?.length === 0 && w.demo !== true ? ADD_A_CHECK : undefined

  return [...screen, '', 'Details:', ...detailLines(lines), ...(order === undefined ? [] : ['', order])].join('\n')
}

/**
 * The person names the full check (`/check <command>`). What was there
 * before stays the baseline (the frozen check files, the fingerprint and the
 * start), so a check changed earlier is still seen; only the command is new.
 * Hands back why the command cannot be the full check, if it cannot.
 */
async function nameCheck($: EngineInterface, command: string): Promise<string | undefined> {
  const flag = cannotCheck(command)

  if (flag !== undefined) {
    return NO_CHECK_RUN(command, flag)
  }

  const w = await read($, watch)
  const named = await fresh($, command)

  if (w === null) {
    // The person's word: armed even when no test file was found.
    await setWatch($, named, await walk($))

    return undefined
  }

  // The runs of the old command are no runs of the new one.
  const { fullRun: _run, tried: _tried, also: _also, ...kept } = w
  await update($, watch, () => ({ ...kept, verdict: named.verdict, ...(named.also === undefined ? {} : { also: named.also }) }))

  return undefined
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
    const refused = await nameCheck($, asked)
    if (refused !== undefined) return refused
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

  const seen = await look($, w)
  const run = checkPrompt(w.verdict)
  const order = repairOrder(rule(w, seen.changes, seen.walked.print), w.verdict) ?? run
  await update($, watch, x => (x !== null && x.id === w.id ? { ...x, fixes: x.fixes + 1 } : x))
  sendAsPerson($, order)
  await refreshStatus($)

  return order === run
    ? `Lie Eater asked the AI to run the full check (\`${w.verdict}\`) by itself.`
    : `Lie Eater sent the AI back to repair what it found and to run the full check (\`${w.verdict}\`).`
}

/**
 * `/accept` ("Accept this change"): the person accepts what the red result
 * shows, and nothing later: refused when the project's fingerprint differs
 * from the one measured for that result. The check files are frozen again,
 * and the earlier full run is void: "not checked" until a new full check passes.
 */
export async function acceptCmd($: EngineInterface): Promise<string> {
  const w = await read($, watch)
  const last = w === null ? undefined : (await read($, rulings)).findLast(r => r.termsId === w.id)

  if (w === null || last === undefined || !isOpenRed(last)) {
    return NOTHING_TO_ACCEPT
  }

  const walked = await walk($, w.root)

  if (walked.print === undefined || last.print === undefined) {
    $.ui.toast(NOT_READ)

    return NOT_READ
  }

  if (walked.print !== last.print) {
    // The button drops the answer: the person is told here too.
    $.ui.toast(CHANGED_SINCE)

    return CHANGED_SINCE
  }

  await update($, rulings, list => list.map(r => (r.id === last.id ? { ...r, accepted: true as const } : r)))
  await writeReceipts($, w)
  await rearm($, w, { walked, set: await freeze($, walked.names.filter(isFrozen)) }, true)
  await refreshStatus($)

  return ACCEPTED
}

/**
 * `/lie-eater demo`: a tiny project with one bug and one failing test, and
 * act 1's staged order to the AI: the lazy fix. The demo runs on a watch of its
 * own: the project's watch (and its frozen check files) is kept aside,
 * untouched, and put back after the demo.
 */
export async function demoCmd($: EngineInterface): Promise<string> {
  const w = await read($, watch)

  if (w !== null && isOpenRed((await read($, rulings)).findLast(r => r.termsId === w.id))) {
    return RESULT_FIRST
  }

  const there = await $.fs.list(await inProject($, DEMO_DIR)).catch(() => [])

  if (there.some(entry => !(entry.name in DEMO_FILES))) {
    return DEMO_NOT_OURS
  }

  for (const [name, text] of Object.entries(DEMO_FILES)) {
    await $.fs.write(await inProject($, `${DEMO_DIR}/${name}`), text)
  }

  if (w !== null && w.demo !== true) {
    const kept = await read($, frozen)
    await update($, parked, () => ({ watch: w, frozen: kept }))
  }

  await setWatch($, { ...(await fresh($, DEMO_VERDICT)), demo: true, root: DEMO_DIR }, await walk($, DEMO_DIR))
  await update($, closing, () => null)
  // The person asked to watch: the pane opens.
  await $.ui.open({ id: PANE, title: 'Lie Eater' }).catch(() => undefined)
  sendAsPerson($, DEMO_PROMPT)
  await refreshStatus($)

  return DEMO_INTRO.join('\n')
}
