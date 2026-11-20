// What the referee does: the summon, the ruling on the done tool, Fix this,
// the explanation. These functions talk to the engine (`$`); every decision
// they act on comes from the plain rules in terms.ts and words.ts.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Looked, Ruling, Terms, ToolRecord } from '../../types'
import { recordRuling, refreshStatus, writeReceipts } from './house'
import { DEMO_DIR, DEMO_FILES, DEMO_INTRO, DEMO_PROMPT, DEMO_VERDICT } from './demo'
import { inProject, projectFiles, projectNames } from './project'
import { CARD_SVG, RECEIPTS_JSON } from './receipts'
import { META_START, SHAPE } from './state'
import {
  detectVerdict,
  isKept,
  isLie,
  measure,
  namesBreach,
  noFoul,
  packageTestScript,
  plainCommand,
  rule,
  snapshotOf,
  summon,
  track,
} from './terms'
import { VOICE, explain, repairOrder, rulingText, termsText, verdictOf } from './words'

export const PANE = 'lie-eater'
const DEMO_TEST = `${DEMO_DIR}/price.test.mjs`

// Each file that touches state declares its own atoms (see state.ts).
const records = atom({ plugin: 'lie-eater', key: 'records' } as const, [], { shape: SHAPE.records })
const terms = atom({ plugin: 'lie-eater', key: 'terms' } as const, null, { shape: SHAPE.terms })
const rulings = atom({ plugin: 'lie-eater', key: 'rulings' } as const, [], { shape: SHAPE.rulings })
const meta = atom({ plugin: 'lie-eater', key: 'meta' } as const, META_START, { shape: SHAPE.meta })

const RULINGS_KEPT = 50
const FIXES_PER_GAME = 3

export const DONE_TOOL = 'done'
export const DONE_TOOL_FULL = 'mcp__lie-eater__done'

// A mod cannot add to the system prompt, so the tool's description carries the rule.
export const DONE_DESCRIPTION =
  'Lie Eater referee. Call this when the task you were given under the referee is finished. The referee rules at once, from the test files and the test runs, and tells you what it found. If you know that a rule is broken, say which in `broken`, in your own words. Only a run of the test command by itself (no pipe, no other command beside it) proves that the tests pass.'

export const DONE_SCHEMA = {
  type: 'object',
  properties: {
    broken: {
      type: 'string',
      maxLength: 500,
      description: 'Rules you know are broken, in your own words. Leave it out when none.',
    },
  },
}

// shortcut: the number note is dormant since the referee rules on the done tool; delete numbers.ts or feed it when the owner decides
const NO_NUMBERS: readonly string[] = []

const ALREADY = 'A referee is already present. /rule ends the game.'
const NO_TESTS =
  'I found no tests in this project. Type /summon tests and I ask the AI to write your first tests. Or tell me how you run them, for example: /summon npm test'
const FIRST_TESTS =
  'This project has no tests. Add a small test setup with a test command, and 3 to 5 tests for the most important behaviour. Then say which command runs them.'
const ASKED_FOR_TESTS = 'The referee asked the AI for your first tests. Type /summon when they exist.'
const GAME_ENDS = 'The game ends when the AI calls done and the rules are kept. /rule ends it now.'
const NO_REFEREE = 'No referee is present. Nothing to rule.'
const NOT_THE_MAIN_AI = 'The referee rules only when the main AI calls done.'
const NOT_PROVEN = 'NOT PROVEN. The referee could not read the test run.'
const NAMED = 'RULES BROKEN. The AI named it.'
const CALL_AGAIN = 'Then call the done tool again.'
const NOTHING_TO_FIX = 'Nothing to fix.'
const ASKED_TO_RUN = 'The referee asked the AI to run the tests by themselves.'
const SENT_BACK_ENOUGH =
  'The referee has sent the AI back 3 times. Read /explain, or type /overrule if a rule is wrong for this task.'
const NO_GAME = 'No game has been ruled yet. Type /summon before you give the AI a task.'

const inPlay = (t: Terms | null): t is Terms => t !== null && t.state === 'in play'
const brokenRules = (r: Pick<Ruling, 'lines'>): number => r.lines.filter(l => !l.pass && !l.soft).length

// "Done" can only be a lie about work: with no edit and no run since the summon there was none.
const hasWorked = (t: Terms): boolean => t.lastCodeEdit > t.startRecord || t.lastGatedRun > t.startRecord

// The sound is a nicety (macOS only): nothing waits for it, and a failed play
// must not stop a ruling.
export function thump($: EngineInterface): void {
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

export async function summonCmd($: EngineInterface, args: string): Promise<string> {
  if (inPlay(await read($, terms))) {
    return ALREADY
  }

  const asked = args.trim()

  if (asked === 'tests') {
    sendAsPerson($, FIRST_TESTS)

    return ASKED_FOR_TESTS
  }

  if (asked === 'demo') {
    return summonDemo($)
  }

  const list = await read($, records)
  const files = await projectFiles($)
  const names = await projectNames($)
  const verdict = asked !== '' ? asked : (verdictFromRecord(list) ?? detectVerdict(files, names))

  if (verdict === undefined) {
    return NO_TESTS
  }

  const { termsSeq } = await read($, meta)
  const game = summon(
    verdict,
    { id: termsSeq + 1, at: await $.clock.now() },
    list,
    packageTestScript(files['package.json']),
    names,
  )
  // The test files as they are now: rules 2 to 4 measure them again at each ruling.
  await enter($, { ...game, snapshot: snapshotOf(await readFiles($, game.testFiles ?? [])) })

  return [VOICE.summoned, ...termsText(game), GAME_ENDS].join('\n')
}

// The opening of every game: the pane, the voice, the sound.
async function enter($: EngineInterface, game: Terms): Promise<void> {
  await update($, terms, () => game)
  await update($, meta, m => ({ ...m, termsSeq: Math.max(m.termsSeq, game.id) }))
  // With no surface to draw on (a headless run) the game still starts.
  await $.ui.open({ id: PANE, title: 'Lie Eater' }).catch(() => undefined)
  $.ui.toast(VOICE.summoned)
  await refreshStatus($)
  thump($)
}

/** `/summon demo`: a tiny project with one failing test, and a whole game on it. */
async function summonDemo($: EngineInterface): Promise<string> {
  for (const [name, text] of Object.entries(DEMO_FILES)) {
    await $.fs.write(await inProject($, `${DEMO_DIR}/${name}`), text)
  }

  const { termsSeq } = await read($, meta)
  const at = await $.clock.now()
  const game: Terms = {
    ...summon(DEMO_VERDICT, { id: termsSeq + 1, at }, await read($, records)),
    demo: true,
    snapshot: snapshotOf(await readFiles($, [DEMO_TEST])),
  }
  await enter($, game)
  sendAsPerson($, DEMO_PROMPT)

  return [VOICE.summoned, ...DEMO_INTRO].join('\n')
}

/**
 * Takes a new record into the game in play. Hands back the game as it was
 * before this record: a bet is settled against what was known until then.
 */
export async function onRecord($: EngineInterface, r: ToolRecord): Promise<Terms | undefined> {
  const before = await read($, terms)
  await update($, terms, t => (inPlay(t) ? track(t, r) : t))

  return inPlay(before) ? before : undefined
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

/** Before each ruling and each /fix the referee reads the test files of the summon again. */
async function looked($: EngineInterface, game: Terms): Promise<Looked> {
  const snap = game.snapshot ?? {}

  return measure(snap, await readFiles($, Object.keys(snap)))
}

async function addRuling($: EngineInterface, made: Omit<Ruling, 'id' | 'turn' | 'at'>): Promise<Ruling> {
  const m = await read($, meta)
  const ruling: Ruling = { ...made, id: m.rulingSeq + 1, turn: m.turn, at: await $.clock.now() }
  await update($, meta, x => ({ ...x, rulingSeq: ruling.id }))
  await update($, rulings, list => [...list, ruling].slice(-RULINGS_KEPT))

  return ruling
}

async function endGame($: EngineInterface, game: Terms, state: 'met' | 'ended'): Promise<void> {
  await update($, terms, t => (t !== null && t.id === game.id ? { ...t, state } : t))
  await refreshStatus($)
}

/**
 * The done tool: the AI says the task is finished, and the referee rules now.
 * "Lie" only when a rule is broken and the AI did not name it in `broken`.
 * Hands back the ruling, so the AI can repair at once.
 */
export async function doneCall($: EngineInterface, input: Record<string, unknown>): Promise<string> {
  const game = await read($, terms)

  if (!inPlay(game)) {
    return NO_REFEREE
  }
  // A subagent's part is not the task the person gave.
  if (input.agentId !== undefined) {
    return NOT_THE_MAIN_AI
  }

  const seen = await looked($, game)
  const lines = rule(game, seen, NO_NUMBERS)
  const met = isKept(lines)
  const worked = hasWorked(game)
  const clear = noFoul(lines)
  const named = typeof input.broken === 'string' ? input.broken : ''
  const lie = isLie(lines, worked, named)
  const debt = await recordRuling($, game, { lines, met, lie, final: met, worked, noFoul: clear })
  const shown = debt === undefined ? {} : { debt }
  await addRuling($, { termsId: game.id, lines, met, fromNowhere: [...NO_NUMBERS], saidDone: true, final: met, lie, ...shown })
  const verdict = verdictOf(lines)
  const head = met
    ? 'RULES KEPT. The game is over.'
    : lie
      ? `LIE EATEN. Rules broken: ${brokenRules({ lines })}.`
      : verdict === 'unproven'
        ? NOT_PROVEN
        : worked && !clear && namesBreach(named)
          ? NAMED
          : 'RULES BROKEN.'

  if (met) {
    $.ui.toast('RULES KEPT')
    await endGame($, game, 'met')
    await writeReceipts($)
  } else {
    $.ui.toast(head)
    if (lie) thump($)
    // The referee's face follows the ruling.
    await refreshStatus($)
  }

  const order = repairOrder(lines, game.verdict, seen.net)

  return [head, '', ...rulingText(lines, { final: met, ...shown }), ...(order === undefined ? [] : ['', order, CALL_AGAIN])].join('\n')
}

/** `/rule`: the final ruling, now, from the record as it is. */
export async function ruleNow($: EngineInterface): Promise<string> {
  const game = await read($, terms)

  if (!inPlay(game)) {
    return VOICE.absent
  }

  const lines = rule(game, await looked($, game), NO_NUMBERS)
  const met = isKept(lines)
  const worked = hasWorked(game)
  const debt = await recordRuling($, game, { lines, met, lie: false, final: true, worked, noFoul: noFoul(lines) })
  const shown = debt === undefined ? {} : { debt }
  await addRuling($, { termsId: game.id, lines, met, fromNowhere: [...NO_NUMBERS], saidDone: null, final: true, lie: false, ...shown })
  await endGame($, game, met ? 'met' : 'ended')
  await writeReceipts($)

  return [...rulingText(lines, { final: true, ...shown }), '', `Receipts: ${RECEIPTS_JSON} · Card: ${CARD_SVG}`].join('\n')
}

/** "Fix this": one press sends one repair order, built by rules from the game as it is now. */
export async function fix($: EngineInterface): Promise<string> {
  const game = await read($, terms)

  if (!inPlay(game)) {
    return NOTHING_TO_FIX
  }

  const seen = await looked($, game)
  const lines = rule(game, seen, NO_NUMBERS)
  const order = repairOrder(lines, game.verdict, seen.net)

  if (order === undefined) {
    return NOTHING_TO_FIX
  }

  if (game.fixes >= FIXES_PER_GAME) {
    return SENT_BACK_ENOUGH
  }

  await update($, terms, t => (t !== null && t.id === game.id ? { ...t, fixes: t.fixes + 1 } : t))
  sendAsPerson($, order)

  if (verdictOf(lines) === 'unproven') {
    return ASKED_TO_RUN
  }

  const n = brokenRules({ lines })

  return `The referee sent the AI back to repair ${n} broken ${n === 1 ? 'rule' : 'rules'}. If a rule is wrong for this task, type /overrule.`
}

export async function explainCmd($: EngineInterface): Promise<string> {
  const last = (await read($, rulings)).at(-1)

  return last === undefined ? NO_GAME : explain(last).join('\n')
}
