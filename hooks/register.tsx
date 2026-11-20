import type { Register } from 'claude-code'

import { BET_DESCRIPTION, BET_SCHEMA, BET_TOOL, BET_TOOL_FULL, GATE_TEXT, betText } from './lib/bets'
import { closeBets, openBet, refuseRun, settle, statusText, takeBet } from './lib/betting'
import { betRows, canFix, diceFace, recordHeader, recordRows, refereeRows, scoreLines } from './lib/face'
import type { Tone } from './lib/face'
import { PANE, explainCmd, fix, onRecord, ruleNow, ruleTurn, summonCmd } from './lib/referee'
import { isRefereePresent, paneView, remember, startTurn } from './lib/store'

const COMMANDS = [
  { name: 'summon', description: 'Call the referee: lock the rules before the AI works' },
  { name: 'rule', description: 'Lie Eater: the final ruling now; ends the game' },
  { name: 'fix', description: 'Lie Eater: send the AI back to repair the broken rules' },
  { name: 'explain', description: 'Lie Eater: the last ruling in three plain sentences' },
  { name: 'lie-eater', description: 'Open the Lie Eater pane' },
] as const

const TONE: Record<Tone, { bold?: boolean; color?: string; dimColor?: boolean }> = {
  title: { bold: true },
  plain: {},
  good: { color: 'green' },
  bad: { color: 'red' },
  quiet: { dimColor: true },
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const command of COMMANDS) {
      await $.command.register(command)
    }

    // A mod cannot add to the system prompt, and a tool registered later is not
    // proven to reach the agent: the bet tool is always there, and says so when
    // no referee is present.
    await $.tool.register({
      name: BET_TOOL,
      description: BET_DESCRIPTION,
      inputSchema: BET_SCHEMA,
      isDeferred: false,
    })

    // After a reload in the middle of a game the referee is still present.
    if (await isRefereePresent($)) {
      $.ui.status(statusText((await paneView($)).bets))
    }

    return next(e)
  })

  on('command.run', { command: 'summon' }, async ($, e) => ({ text: await summonCmd($, e.args) }))
  on('command.run', { command: 'rule' }, async $ => ({ text: await ruleNow($) }))
  on('command.run', { command: 'fix' }, async $ => ({ text: await fix($) }))
  on('command.run', { command: 'explain' }, async $ => ({ text: await explainCmd($) }))
  on('command.run', { command: 'lie-eater' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Lie Eater' })

    return { text: 'Lie Eater pane opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const origin = e.origin as { kind?: string; name?: string } | undefined
    const isOwn = origin?.kind === 'plugin' && origin.name === $.plugin.name
    await startTurn($, e.text, isOwn)

    return next(e)
  })

  // The recorder only watches. A fault in it must never touch the call:
  // the handler replays what the call settled to.
  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>

    if (input.tool === BET_TOOL_FULL) {
      return { result: await takeBet($, input) }
    }

    // The one thing the mod ever refuses: a test or build run with no bet,
    // while a referee is present.
    if (await refuseRun($, input)) {
      return { deny: GATE_TEXT }
    }

    const ran = await next(e)

    if (ran.deny === undefined) {
      const made = await remember($, input, ran)

      if (made !== undefined) {
        const line = await settle($, made, await onRecord($, made))

        if (line !== undefined) {
          return { ...ran, context: [...(ran.context ?? []), line] }
        }
      }
    }

    return ran
  }).catch(($, e, next) => next(e))

  // The ruling comes after the turn and never delays the answer.
  on('turn.complete', async ($, e, next) => {
    const out = await next(e)

    if (e.agentId === undefined) {
      await closeBets($)

      if (e.reason === 'answer') {
        void ruleTurn($, e.answer).catch(() => undefined)
      }
    }

    return out
  })

  // The dice: while a bet is open the spinner row shows it.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const bet = await openBet($)

    if (bet === undefined) {
      return next(e)
    }

    return next({ ...e, props: { ...e.props, word: `${diceFace(Date.now())} bet open: ${betText(bet)}` } })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const columns = e.props.bodyColumns
    const { game, ruling, list, bets, unbet, note } = await paneView($)
    const room = game === null ? Math.max(1, (e.viewport?.rows ?? 24) - 4) : 5

    return (
      <Box flexDirection="column">
        {note !== undefined && <Text dimColor>{note.slice(0, columns)}</Text>}
        {refereeRows(game, ruling, columns).map(row => (
          <Text {...TONE[row.tone]}>{row.text}</Text>
        ))}
        {canFix(game, ruling) && (
          <Box>
            <Button key="fix" label="Fix this" hotkey="f" onPress={() => fix($)} />
            <Text dimColor> or type /fix</Text>
          </Box>
        )}
        {[...scoreLines(bets, unbet), ...betRows(bets, columns)].map(row => (
          <Text {...TONE[row.tone]}>{row.text.slice(0, columns)}</Text>
        ))}
        <Text dimColor>{recordHeader(list)}</Text>
        {recordRows(list.slice(-room), columns).map(row => (
          <Text dimColor>{row}</Text>
        ))}
      </Box>
    )
  })
}
