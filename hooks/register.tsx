import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Meta } from '../types'
import { recordHeader, recordRows } from './lib/face'
import { appendRecord, nextMeta, toRawCall } from './lib/intake'

const PANE = 'lie-eater'
const META_START: Meta = {
  seq: 0,
  betSeq: 0,
  rulingSeq: 0,
  termsSeq: 0,
  turn: 0,
  denies: 0,
  unbet: 0,
  promptNumbers: [],
}

// Change a tag when a value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const records = atom({ plugin: 'lie-eater', key: 'records' } as const, [], { shape: 'records-1' })
const meta = atom({ plugin: 'lie-eater', key: 'meta' } as const, META_START, { shape: 'meta-1' })

// The engine follows `$` only into functions declared at the top of a file.
async function remember(
  $: EngineInterface,
  input: Record<string, unknown>,
  ran: { text?: string; isError?: boolean; result?: unknown },
): Promise<void> {
  const raw = toRawCall(input, ran)
  const { turn } = await read($, meta)
  const at = await $.clock.now()
  await update($, records, list => appendRecord(list, raw, turn, at))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'lie-eater',
      description: 'Open the Lie Eater pane',
    })

    return next(e)
  })

  on('command.run', { command: 'lie-eater' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Lie Eater' })

    return { text: 'Lie Eater pane opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const origin = e.origin as { kind?: string; name?: string } | undefined
    const isOwn = origin?.kind === 'plugin' && origin.name === $.plugin.name
    await update($, meta, m => nextMeta(m, e.text, isOwn))

    return next(e)
  })

  // The recorder only watches. A fault in it must never touch the call:
  // the handler replays what the call settled to.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)

    if (ran.deny === undefined) {
      await remember($, e as unknown as Record<string, unknown>, ran)
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, records)
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 4)

    return (
      <Box flexDirection="column">
        <Text dimColor>{recordHeader(list)}</Text>
        {recordRows(list.slice(-room), e.props.bodyColumns).map(row => (
          <Text>{row}</Text>
        ))}
      </Box>
    )
  })
}
