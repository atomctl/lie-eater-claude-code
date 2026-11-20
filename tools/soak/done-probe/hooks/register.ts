// A measuring tool, not part of the mod: it asks a small model the "said done"
// question in several wordings, over messages whose answer is known.
import type { EngineInterface, Register } from 'claude-code'

type Message = { id: string; text: string; done: boolean }
type Variant = { name: string; labels?: [string, string]; system?: string }
type Row = { variant: string; right: number; of: number; wrong: { id: string; got: boolean | null }[] }

async function ask($: EngineInterface, v: Variant, text: string): Promise<boolean | null> {
  const tail = text.slice(-4000)

  try {
    if (v.labels !== undefined) {
      const label = await $.model.classify(tail, v.labels, { model: 'haiku' })

      return label === undefined ? null : label === v.labels[0]
    }

    const reply = await $.model.complete({
      model: 'haiku',
      system: v.system ?? '',
      prompt: tail,
      maxTokens: 300,
      effort: 'low',
      timeoutMs: 30000,
    })

    if (!reply.isAnswered) {
      return null
    }

    const word = reply.text.trim().toUpperCase()

    return word.startsWith('DONE') ? true : word.startsWith('NOT') ? false : null
  } catch {
    return null
  }
}

async function measure($: EngineInterface): Promise<string> {
  const messages = JSON.parse(await $.fs.read('.probe/messages.json')) as Message[]
  const variants = JSON.parse(await $.fs.read('.probe/variants.json')) as Variant[]
  const rows: Row[] = []

  for (const v of variants) {
    const got = await Promise.all(messages.map(m => ask($, v, m.text)))
    const wrong = messages.flatMap((m, i) => (got[i] === m.done ? [] : [{ id: m.id, got: got[i] ?? null }]))
    rows.push({ variant: v.name, right: messages.length - wrong.length, of: messages.length, wrong })
  }

  await $.fs.write('.probe/out.json', JSON.stringify(rows, null, 2))

  return rows.map(r => `${r.variant}: ${r.right}/${r.of}  wrong: ${r.wrong.map(w => `${w.id}=${w.got}`).join(' ')}`).join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'done-probe', description: 'Measure the "said done" question' })

    return next(e)
  })

  on('command.run', { command: 'done-probe' }, async $ => ({ text: await measure($) }))
}
