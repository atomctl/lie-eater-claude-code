// What the referee does: the summon, the ruling, Fix this, the explanation.
// These functions talk to the engine (`$`); every decision they act on comes
// from the plain rules in terms.ts, numbers.ts and words.ts.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Ruling, Terms, ToolRecord } from '../../types'
import { checkNumbers } from './numbers'
import { META_START, SHAPE } from './state'
import { bareCommand, detectVerdict, isKept, rule, summon, track } from './terms'
import { VOICE, explain, repairOrder, rulingText, termsText } from './words'

export const PANE = 'lie-eater'
export const STATUS_PRESENT = 'Referee present'

// Each file that touches state declares its own atoms (see state.ts).
const records = atom({ plugin: 'lie-eater', key: 'records' } as const, [], { shape: SHAPE.records })
const terms = atom({ plugin: 'lie-eater', key: 'terms' } as const, null, { shape: SHAPE.terms })
const rulings = atom({ plugin: 'lie-eater', key: 'rulings' } as const, [], { shape: SHAPE.rulings })
const meta = atom({ plugin: 'lie-eater', key: 'meta' } as const, META_START, { shape: SHAPE.meta })

const RULINGS_KEPT = 50
const FIXES_PER_GAME = 3
const DONE_LABELS = ['says the work is finished or working', 'does not say that']
const PROJECT_FILES = ['package.json', 'pyproject.toml', 'pytest.ini', 'Cargo.toml', 'go.mod', 'Makefile']

const ALREADY = 'A referee is already present. /rule ends the game.'
const NO_TESTS =
  'I found no tests in this project. Type /summon tests and I ask the AI to write your first tests. Or tell me how you run them, for example: /summon npm test'
const FIRST_TESTS =
  'This project has no tests. Add a small test setup with a test command, and 3 to 5 tests for the most important behaviour. Then say which command runs them.'
const ASKED_FOR_TESTS = 'The referee asked the AI for your first tests. Type /summon when they exist.'
const GAME_ENDS = 'The game ends by itself when the rules are kept. /rule ends it now.'
const NOTHING_TO_FIX = 'Nothing to fix.'
const SENT_BACK_ENOUGH =
  'The referee has sent the AI back 3 times. Read /explain, or type /overrule if a rule is wrong for this task.'
const NO_GAME = 'No game has been ruled yet. Type /summon before you give the AI a task.'

const inPlay = (t: Terms | null): t is Terms => t !== null && t.state === 'in play'
const brokenRules = (r: Pick<Ruling, 'lines'>): number => r.lines.filter(l => !l.pass && !l.soft).length

const latestRuling = (list: readonly Ruling[], termsId: number): Ruling | undefined =>
  list.findLast(r => r.termsId === termsId)

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

async function projectFiles($: EngineInterface): Promise<Record<string, string | undefined>> {
  const texts = await Promise.all(PROJECT_FILES.map(name => $.fs.read(name).catch(() => undefined)))

  return Object.fromEntries(PROJECT_FILES.map((name, i) => [name, texts[i]]))
}

// The newest test run that is a plain command: not chained, silenced or filtered.
function verdictFromRecord(list: readonly ToolRecord[]): string | undefined {
  return list
    .filter(r => r.kind === 'test')
    .map(r => bareCommand(r.target))
    .findLast(command => !/[|;&]/.test(command))
}

/** The one question a model answers. It reads the agent's words; it never rules. */
export async function saidDone($: EngineInterface, answer: string): Promise<boolean | null> {
  if (answer.trim().length < 20) {
    return false
  }

  try {
    const label = await $.model.classify(answer.slice(-4000), DONE_LABELS, { model: 'haiku' })

    return label === undefined ? null : label === DONE_LABELS[0]
  } catch {
    return null
  }
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

  const list = await read($, records)
  const verdict = asked !== '' ? asked : (verdictFromRecord(list) ?? detectVerdict(await projectFiles($)))

  if (verdict === undefined) {
    return NO_TESTS
  }

  const { termsSeq } = await read($, meta)
  const game = summon(verdict, { id: termsSeq + 1, at: await $.clock.now() }, list)
  await update($, terms, () => game)
  await update($, meta, m => ({ ...m, termsSeq: game.id, note: undefined }))
  // With no surface to draw on (a headless run) the game still starts.
  await $.ui.open({ id: PANE, title: 'Lie Eater' }).catch(() => undefined)
  $.ui.toast(VOICE.summoned)
  $.ui.status(STATUS_PRESENT)
  thump($)

  return [VOICE.summoned, ...termsText(game), GAME_ENDS].join('\n')
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

async function addRuling($: EngineInterface, made: Omit<Ruling, 'id' | 'turn' | 'at'>): Promise<Ruling> {
  const m = await read($, meta)
  const ruling: Ruling = { ...made, id: m.rulingSeq + 1, turn: m.turn, at: await $.clock.now() }
  await update($, meta, x => ({ ...x, rulingSeq: ruling.id }))
  await update($, rulings, list => [...list, ruling].slice(-RULINGS_KEPT))

  return ruling
}

async function endGame($: EngineInterface, game: Terms, state: 'met' | 'ended'): Promise<void> {
  await update($, terms, t => (t !== null && t.id === game.id ? { ...t, state } : t))
  $.ui.status(undefined)
}

/** The ruling at the end of a turn. Rules decide every line; the model only says "said done". */
export async function ruleTurn($: EngineInterface, answer: string): Promise<void> {
  const game = await read($, terms)

  if (!inPlay(game)) {
    return
  }

  const { promptNumbers, turn } = await read($, meta)
  const { fromNowhere } = checkNumbers(answer, await read($, records), promptNumbers)
  const lines = rule(game, fromNowhere)
  const met = isKept(lines)
  const done = await saidDone($, answer)

  // The model takes a moment. If /rule ended the game meanwhile, its ruling stands.
  if (!inPlay(await read($, terms))) {
    return
  }

  const ruling = await addRuling($, {
    termsId: game.id,
    lines,
    met,
    fromNowhere,
    saidDone: done,
    final: done === true && met,
    lie: done === true && !met,
  })

  if (done === null) {
    await update($, meta, m => ({
      ...m,
      note: `Turn ${turn}: no answer on "said done"; the ruling is shown as "so far"`,
    }))
  }

  if (ruling.lie) {
    $.ui.toast(`LIE EATEN. Rules broken: ${brokenRules(ruling)}.`)
    thump($)
  }

  if (ruling.final) {
    $.ui.toast('RULES KEPT')
    await endGame($, game, 'met')
  }
}

/** `/rule`: the final ruling, now, from the record as it is. */
export async function ruleNow($: EngineInterface): Promise<string> {
  const game = await read($, terms)

  if (!inPlay(game)) {
    return VOICE.absent
  }

  const fromNowhere = latestRuling(await read($, rulings), game.id)?.fromNowhere ?? []
  const lines = rule(game, fromNowhere)
  const met = isKept(lines)
  await addRuling($, { termsId: game.id, lines, met, fromNowhere, saidDone: null, final: true, lie: false })
  await endGame($, game, met ? 'met' : 'ended')

  return rulingText(lines, { final: true }).join('\n')
}

/** "Fix this": one press sends one repair order, built by rules from the game as it is now. */
export async function fix($: EngineInterface): Promise<string> {
  const game = await read($, terms)

  if (!inPlay(game)) {
    return NOTHING_TO_FIX
  }

  const lines = rule(game, latestRuling(await read($, rulings), game.id)?.fromNowhere ?? [])
  const order = repairOrder(lines, game)

  if (order === undefined) {
    return NOTHING_TO_FIX
  }

  if (game.fixes >= FIXES_PER_GAME) {
    return SENT_BACK_ENOUGH
  }

  await update($, terms, t => (t !== null && t.id === game.id ? { ...t, fixes: t.fixes + 1 } : t))
  sendAsPerson($, order)
  const n = brokenRules({ lines })

  return `The referee sent the AI back to repair ${n} broken ${n === 1 ? 'rule' : 'rules'}. If a rule is wrong for this task, type /overrule.`
}

export async function explainCmd($: EngineInterface): Promise<string> {
  const last = (await read($, rulings)).at(-1)

  return last === undefined ? NO_GAME : explain(last).join('\n')
}
