import type { Register } from 'claude-code'

import { BET_DESCRIPTION, BET_SCHEMA, BET_TOOL, BET_TOOL_FULL, betText } from './lib/bets'
import { callIt, closeBets, openBet, refuseRun, settle, takeBet } from './lib/betting'
import { betRows, canFix, diceFace, houseRows, recordHeader, recordRows, refereeRows, scoreLines } from './lib/face'
import type { Tone } from './lib/face'
import { loadLedger, overruleCmd, refreshStatus } from './lib/house'
import { DONE_DESCRIPTION, DONE_SCHEMA, DONE_TOOL, DONE_TOOL_FULL, PANE, doneCall, explainCmd, fix, onRecord, ruleNow, summonCmd } from './lib/referee'
import { paneView, remember, startTurn } from './lib/store'

const COMMANDS = [
  { name: 'summon', description: 'Call the referee: lock the rules before the AI works' },
  { name: 'rule', description: 'Lie Eater: the final ruling now; ends the game' },
  { name: 'fix', description: 'Lie Eater: send the AI back to repair the broken rules' },
  { name: 'explain', description: 'Lie Eater: the last ruling in three plain sentences' },
  { name: 'overrule', description: 'Lie Eater: overrule the last broken ruling; the debt is cleared' },
  { name: 'call', description: 'Lie Eater: bet against your AI: /call pass or /call fail while its bet is open' },
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
    // proven to reach the agent: the two tools are always there, and say so when
    // no referee is present.
    await $.tool.register({
      name: BET_TOOL,
      description: BET_DESCRIPTION,
      inputSchema: BET_SCHEMA,
      isDeferred: false,
    })
    await $.tool.register({
      name: DONE_TOOL,
      description: DONE_DESCRIPTION,
      inputSchema: DONE_SCHEMA,
      isDeferred: false,
    })

    // What the house remembers about this repository, and the status line
    // (after a reload in the middle of a game the referee is still present).
    await loadLedger($, e.cwd)

    return next(e)
  })

  on('command.run', { command: 'summon' }, async ($, e) => ({ text: await summonCmd($, e.args) }))
  on('command.run', { command: 'rule' }, async $ => ({ text: await ruleNow($) }))
  on('command.run', { command: 'fix' }, async $ => ({ text: await fix($) }))
  on('command.run', { command: 'explain' }, async $ => ({ text: await explainCmd($) }))
  on('command.run', { command: 'overrule' }, async ($, e) => ({ text: await overruleCmd($, e.args) }))
  on('command.run', { command: 'call' }, async ($, e) => ({ text: await callIt($, e.args) }))
  on('command.run', { command: 'lie-eater' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Lie Eater' })

    return { text: 'Lie Eater pane opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
    await startTurn($)

    return next(e)
  })

  // The recorder only watches. A fault in it must never touch the call:
  // the handler replays what the call settled to.
  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>

    if (input.tool === BET_TOOL_FULL) {
      return { result: await takeBet($, input) }
    }
    // The AI says the task is finished: the one moment the referee rules by itself.
    if (input.tool === DONE_TOOL_FULL) {
      return { result: await doneCall($, input) }
    }

    // The one thing the mod ever refuses: a test or build run with no bet,
    // while a referee is present.
    const refusal = await refuseRun($, input)

    if (refusal !== undefined) {
      return { deny: refusal }
    }

    const ran = await next(e)

    if (ran.deny === undefined) {
      const made = await remember($, input, ran)

      if (made !== undefined) {
        const line = await settle($, made, await onRecord($, made))
        // The flag and the referee's face follow every call.
        await refreshStatus($)

        if (line !== undefined) {
          return { ...ran, context: [...(ran.context ?? []), line] }
        }
      }
    }

    return ran
  }).catch(($, e, next) => next(e))

  // The end of a turn rules nothing (the done tool does): it only closes the bets.
  on('turn.complete', async ($, e, next) => {
    const out = await next(e)

    if (e.agentId === undefined) {
      await closeBets($)
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
    const { game, ruling, list, bets, unbet, ledger, referee } = await paneView($)
    const room = game === null ? Math.max(1, (e.viewport?.rows ?? 24) - 4) : 5

    return (
      <Box flexDirection="column">
        {refereeRows(game, ruling, columns, referee).map(row => (
          <Text {...TONE[row.tone]}>{row.text}</Text>
        ))}
        {canFix(game, ruling) && (
          <Box>
            <Button key="fix" label="Fix this" hotkey="f" onPress={() => fix($)} />
            <Text dimColor> or type /fix</Text>
          </Box>
        )}
        {bets.some(b => b.state === 'open') && (
          <Box>
            <Text dimColor>Your call: </Text>
            <Button key="call-pass" label="it will pass" hotkey="1" onPress={() => callIt($, 'pass')} />
            <Text> </Text>
            <Button key="call-fail" label="it will fail" hotkey="2" onPress={() => callIt($, 'fail')} />
            <Text dimColor> or /call pass</Text>
          </Box>
        )}
        {[...scoreLines(bets, unbet), ...betRows(bets, columns), ...houseRows(ledger, columns)].map(row => (
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
