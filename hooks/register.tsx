import type { Register } from 'claude-code'

import { BET_DESCRIPTION, BET_SCHEMA, BET_TOOL, BET_TOOL_FULL } from './lib/bets'
import { callIt, closeBets, refuseRun, settle, takeBet } from './lib/betting'
import { loadLedger, refreshStatus } from './lib/house'
import { DEMO_HINT } from './lib/demo'
import { FACE_WIDTH, PIXEL_COLUMNS, PLAIN, faceRows } from './lib/munch'
import { detailRows } from './lib/pane'
import {
  DONE_DESCRIPTION,
  DONE_SCHEMA,
  DONE_TOOL,
  DONE_TOOL_FULL,
  PANE,
  acceptCmd,
  armIfNone,
  beforeRun,
  checkCmd,
  demoCmd,
  doneCall,
  onRecord,
} from './lib/referee'
import { munchOf } from './lib/result'
import { paneClosed, paneView, remember, showDetails, startTurn } from './lib/store'

const COMMANDS = [
  { name: 'check', description: 'Lie Eater: check again. The AI runs the full check (and repairs what was found). /check <command> names the test command' },
  { name: 'accept', description: 'Lie Eater: accept the change that "don\'t trust done" shows' },
  { name: 'call', description: 'Lie Eater: your own call on the AI\'s open bet: /call pass or /call fail' },
  { name: 'lie-eater', description: 'Open the Lie Eater pane. /lie-eater details shows the evidence too; /lie-eater demo shows it on a tiny project' },
] as const
const OWN_COMMANDS: ReadonlySet<string> = new Set(COMMANDS.map(c => c.name))
const DETAILS_HINT = 'Details: /lie-eater details'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const command of COMMANDS) {
      await $.command.register(command)
    }

    // A mod cannot add to the system prompt, and a tool registered later is not
    // proven to reach the agent: the two tools are always there.
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

    // Always on: the bets of this repository, the watch (armed silently when
    // checks exist; a reload keeps the one it had), and the status line.
    await loadLedger($)
    await armIfNone($)
    await refreshStatus($)

    return next(e)
  })

  on('command.run', { command: 'check' }, async ($, e) => ({ text: await checkCmd($, e.args) }))
  on('command.run', { command: 'accept' }, async $ => ({ text: await acceptCmd($) }))
  on('command.run', { command: 'call' }, async ($, e) => ({ text: await callIt($, e.args) }))
  on('command.run', { command: 'lie-eater' }, async ($, e) => {
    if (e.args.trim() === 'demo') {
      return { text: await demoCmd($) }
    }

    const details = e.args.trim() === 'details'
    await showDetails($, () => details)
    await $.ui.open({ id: PANE, title: 'Lie Eater' })

    return { text: details ? 'Lie Eater pane opened, with Details.' : 'Lie Eater pane opened.' }
  })

  // Each prompt is a new turn, and a new try to find the project's checks.
  // A fault here must never stop the person's prompt.
  on('prompt.submit', async ($, e, next) => {
    await startTurn($)
    if (await armIfNone($)) await refreshStatus($)
    // The person's own next prompt closes the pane: not a prompt the mod sends, not a command of the mod.
    const kind = e.origin?.kind
    if ((kind === 'composer' || kind === 'bridge') && !OWN_COMMANDS.has(e.command?.name ?? '')) {
      await $.ui.close({ id: PANE }).catch(() => undefined)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // However the pane closes, it opens small the next time, and the demo's closing lines go with it.
  on('ui.close', async ($, e, next) => {
    const out = await next(e)
    if (e.id === PANE) await paneClosed($)

    return out
  })

  // The recorder only watches. A fault in it must never touch the call:
  // the handler replays what the call settled to.
  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>

    if (input.tool === BET_TOOL_FULL) {
      return { result: await takeBet($, input) }
    }
    // The AI says the task is finished: the one moment Lie Eater checks by itself.
    if (input.tool === DONE_TOOL_FULL) {
      return { result: await doneCall($, input) }
    }

    // The one thing the mod ever refuses: a test or build run with no bet.
    const refusal = await refuseRun($, input)

    if (refusal !== undefined) {
      return { deny: refusal }
    }

    // A run of the full check: the project's fingerprint and the shell's folder as the run starts.
    const at = await beforeRun($, input)
    const ran = await next(e)

    if (ran.deny === undefined) {
      const made = await remember($, input, ran)

      if (made !== undefined) {
        const line = await settle($, made, await onRecord($, made, at))
        // A change can make a green line "not checked".
        await refreshStatus($)

        if (line !== undefined) {
          return { ...ran, context: [...(ran.context ?? []), line] }
        }
      }
    }

    return ran
  }).catch(($, e, next) => next(e))

  // The end of a turn checks nothing (the done tool does): it only closes the bets.
  on('turn.complete', async ($, e, next) => {
    const out = await next(e)

    if (e.agentId === undefined) {
      await closeBets($)
    }

    return out
  })

  // The pane: Munch's face at the left of the result, one row of buttons, one dim hint; Details only when asked.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const columns = e.props.bodyColumns
    const view = await paneView($)
    const [title, ...said] = view.now.screen
    const munch = munchOf(view.now)
    const isPixel = columns >= PIXEL_COLUMNS
    const face = isPixel
      ? faceRows(munch.face).map(spans => (
          <Text>
            {spans.map(({ text, ...colour }) => (colour.color === undefined ? text : <Text {...colour}>{text}</Text>))}
          </Text>
        ))
      : PLAIN[munch.face].map(row => <Text>{row}</Text>)
    const action = view.now.action
    const buttons = [
      ...(action === 'repair'
        ? [
            <Button key="repair" label="Put it back and fix the work" hotkey="f" onPress={() => checkCmd($, '')} />,
            <Button key="accept" label="Accept this change" hotkey="a" onPress={() => acceptCmd($)} />,
          ]
        : []),
      ...(action === 'check' ? [<Button key="check" label="Check again" hotkey="c" onPress={() => checkCmd($, '')} />] : []),
      ...(action === 'add' ? [<Button key="add" label="Add checks" hotkey="c" onPress={() => checkCmd($, '')} />] : []),
      <Button key="details" label={view.details ? 'Hide details' : 'Details'} hotkey="d" plain dimColor onPress={() => showDetails($, shown => !shown)} />,
    ]
    // The engine draws no key on a button: the line under them says how to use them.
    const press =
      action === 'repair' ? (view.watch?.demo === true ? DEMO_HINT : 'Press f or a, or type /check or /accept.') : action === undefined ? undefined : 'Press c, or type /check.'

    return (
      <Box flexDirection="column">
        {view.closing !== null && [...view.closing, ' '].map(line => <Text>{line}</Text>)}
        <Box flexDirection="row">
          <Box flexDirection="column" width={isPixel ? FACE_WIDTH.pixel : FACE_WIDTH.plain} flexShrink={0}>
            {face}
          </Box>
          <Box flexDirection="column" flexShrink={1}>
            <Text bold>{title ?? ''}</Text>
            {said.map(line => (
              <Text>{line}</Text>
            ))}
            <Text dimColor>{`"${munch.says}"`}</Text>
          </Box>
        </Box>
        <Box flexDirection="row">{buttons.flatMap((button, i) => (i === 0 ? [button] : [<Text> </Text>, button]))}</Box>
        <Text dimColor>{press === undefined ? DETAILS_HINT : `${press} ${DETAILS_HINT}`}</Text>
        {view.details && [
          <Text dimColor> </Text>,
          <Text dimColor bold>
            Details
          </Text>,
          ...detailRows({ ...view, columns }).map(row => <Text dimColor>{row}</Text>),
        ]}
        {view.details && view.bets.some(b => b.state === 'open') && (
          <Box>
            <Text dimColor>Your call: </Text>
            <Button key="call-pass" label="it will pass" hotkey="1" onPress={() => callIt($, 'pass')} />
            <Text> </Text>
            <Button key="call-fail" label="it will fail" hotkey="2" onPress={() => callIt($, 'fail')} />
          </Box>
        )}
      </Box>
    )
  })
}
