import type { Register } from 'claude-code'

const PANE = 'lie-eater'

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

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text dimColor>No referee is present.</Text>
      </Box>
    )
  })
}
