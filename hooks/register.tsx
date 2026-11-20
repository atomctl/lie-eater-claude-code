import type { Register } from 'claude-code'

import { canFix, recordHeader, recordRows, refereeRows } from './lib/face'
import type { Tone } from './lib/face'
import { PANE, STATUS_PRESENT, explainCmd, fix, onRecord, ruleNow, ruleTurn, summonCmd } from './lib/referee'
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

    // After a reload in the middle of a game the referee is still present.
    if (await isRefereePresent($)) {
      $.ui.status(STATUS_PRESENT)
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
    const ran = await next(e)

    if (ran.deny === undefined) {
      const made = await remember($, e as unknown as Record<string, unknown>, ran)

      if (made !== undefined) {
        await onRecord($, made)
      }
    }

    return ran
  }).catch(($, e, next) => next(e))

  // The ruling comes after the turn and never delays the answer.
  on('turn.complete', async ($, e, next) => {
    const out = await next(e)

    if (e.agentId === undefined && e.reason === 'answer') {
      void ruleTurn($, e.answer).catch(() => undefined)
    }

    return out
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const columns = e.props.bodyColumns
    const { game, ruling, list, note } = await paneView($)
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
        <Text dimColor>{recordHeader(list)}</Text>
        {recordRows(list.slice(-room), columns).map(row => (
          <Text dimColor>{row}</Text>
        ))}
      </Box>
    )
  })
}
