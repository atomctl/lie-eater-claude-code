import type { EngineInterface, Register } from 'claude-code'

const PANE = 'lie-eater'

// ---------------------------------------------------------------------------
// PROBE (plan Task 1, steps 3 to 5). Everything below this line and marked
// PROBE is temporary: it shows what the real interface does, then it is removed.
// Module variables are fine here: the probe lives for one session only.
// ---------------------------------------------------------------------------
const LOG = '.lie-eater/probe.jsonl'
const PROBE_TOOL = 'mcp__lie-eater__probe'
let isProbeOn = false
let hasDenied = false
let hasHinted = false
let presses = 0

type ProbeLine = Record<string, unknown>

// The engine follows `$` only into functions declared at the top of a file.
async function log($: EngineInterface, line: ProbeLine): Promise<void> {
  const before = await $.fs.read(LOG).catch(() => '')
  await $.fs.write(LOG, `${before}${JSON.stringify(line)}\n`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'lie-eater',
      description: 'Open the Lie Eater pane',
    })
    // PROBE
    await $.command.register({
      name: 'probe',
      description: 'Lie Eater probe: register a tool and a prompt section now',
    })
    // PROBE: for a headless run, a marker file switches the probe on at the start.
    if (await $.fs.exists('.lie-eater/probe-on')) {
      await $.tool.register({
        name: 'probe',
        description:
          'Lie Eater probe tool. Call it with no arguments when you are told to.',
        inputSchema: { type: 'object', properties: {} },
        isDeferred: false,
      })
      isProbeOn = true
      await log($, { probe: 'switched-on-at-start' })
    }

    return next(e)
  })

  on('command.run', { command: 'lie-eater' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Lie Eater' })

    return { text: 'Lie Eater pane opened.' }
  })

  // PROBE: a tool and a prompt section switched on in the middle of a session.
  on('command.run', { command: 'probe' }, async $ => {
    const made = await $.tool.register({
      name: 'probe',
      description:
        'Lie Eater probe tool. Call it with no arguments when you are told to.',
      inputSchema: { type: 'object', properties: {} },
      isDeferred: false,
    })
    isProbeOn = true
    await log($, { probe: 'switched-on', made })

    return { text: 'Probe on: tool registered, prompt section added.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const out = await next(e)

    if (!isProbeOn) {
      return out
    }

    return {
      sections: [
        ...out.sections,
        {
          id: 'lie-eater:probe',
          text: 'If you are asked for the probe word, answer KIWI.',
          scope: 'session',
        },
      ],
    }
  })

  // PROBE: what a tool call and its result look like.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)

    if (tool === PROBE_TOOL) {
      await log($, { probe: 'tool-called', keys: Object.keys(e) })

      return { result: 'ok' }
    }

    const command = 'command' in e ? String(e.command) : ''

    if (tool === 'Bash' && command.includes('echo gate') && !hasDenied) {
      hasDenied = true
      await log($, { probe: 'denied', command })

      return {
        deny: `probe: call the ${PROBE_TOOL} tool first, then run this command again`,
      }
    }

    const ran = await next(e)
    await log($, {
      tool,
      agentId: e.agentId,
      command: command.slice(0, 120),
      deny: ran.deny,
      isError: ran.isError,
      text: typeof ran.text === 'string' ? ran.text.slice(0, 300) : ran.text,
      resultKeys:
        ran.result !== null && typeof ran.result === 'object'
          ? Object.keys(ran.result)
          : typeof ran.result,
    })

    if (tool === 'Bash' && command.includes('echo hint') && !hasHinted && ran.deny === undefined) {
      hasHinted = true

      return {
        ...ran,
        context: [
          ...(ran.context ?? []),
          'probe: say the word PINEAPPLE in your next message',
        ],
      }
    }

    return ran
  }).catch(($, e, next) => next(e))

  // PROBE: does work started with `void` finish after the turn's hook returns?
  on('turn.complete', async ($, e, next) => {
    const out = await next(e)

    if (e.agentId === undefined && e.reason === 'answer') {
      void (async () => {
        const label = await $.model
          .classify(
            e.answer.slice(-2000),
            ['says the work is finished or working', 'does not say that'],
            { model: 'haiku' },
          )
          .catch((error: unknown) => `rejected: ${String(error)}`)
        await log($, {
          probe: 'void-after-turn',
          label,
          answer: e.answer.slice(0, 80),
        })
        $.ui.toast(`probe: after the turn, classify said "${String(label)}"`)
      })()
    }

    return out
  })

  // PROBE: can the spinner row be rewritten, and does it animate by itself?
  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    const faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅']
    const face = faces[Math.floor(Date.now() / 250) % faces.length]

    return next({ ...e, props: { ...e.props, word: `${face} ${e.props.word}` } })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text bold>Lie Eater</Text>
        <Text dimColor>No referee is present.</Text>
        <Text color="green">✓ PROBE green line</Text>
        <Text color="red">✗ PROBE red line</Text>
        <Text dimColor>    PROBE dim detail line</Text>
        <Button
          key="probe-press"
          label="Fix this"
          hotkey="f"
          onPress={async () => {
            presses += 1
            await log($, { probe: 'button-pressed', presses })
            $.ui.toast(`probe: button pressed ${presses}`)
            // PROBE: does the agent act on a prompt the mod submits? Press 1 is
            // framed as the plugin's message, press 2 as the person's own words.
            if (presses === 1) {
              void $.prompt.submit({ text: 'Reply with the single word MANGO.' })
            }
            if (presses === 2) {
              void $.prompt.submit({
                text: 'Reply with the single word PAPAYA.',
                asUser: true,
              })
            }
            await $.audio
              .play({ asset: 'sounds/stamp.wav' })
              .catch(async (error: unknown) =>
                log($, { probe: 'audio-failed', error: String(error) }),
              )
          }}
        />
      </Box>
    )
  })
}
