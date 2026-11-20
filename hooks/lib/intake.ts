// From a raw tool call to the record: what the engine hands a hook, turned
// into the plain values the recorder's rules take. Nothing here talks to the engine.
import type { Meta, ToolRecord } from '../../types'
import { extractNumbers, inside, makeRecord } from './record'
import type { RawCall } from './record'

const RECORDS_KEPT = 200
const PROMPT_NUMBERS_KEPT = 50

type Ran = { text?: string; isError?: boolean; result?: unknown }

const text = (from: Record<string, unknown>, key: string): string | undefined =>
  typeof from[key] === 'string' ? (from[key] as string) : undefined

/**
 * `input` is a tool.call event's input; `ran` is what the call resolved to.
 * `root` is the project's root and `stood` where the shell stood before the call.
 */
export function toRawCall(input: Record<string, unknown>, ran: Ran, root = '', stood = ''): RawCall {
  const tool = String(input.tool)
  const result =
    ran.result !== null && typeof ran.result === 'object' ? (ran.result as Record<string, unknown>) : {}
  const raw: RawCall = { tool }
  const agentId = text(input, 'agentId')
  const path = text(input, 'file_path') ?? text(input, 'notebook_path')

  if (agentId !== undefined) raw.agentId = agentId
  if (path !== undefined) raw.path = inside(root, path)

  if (tool === 'Bash') {
    raw.command = text(input, 'command') ?? ''
    if (root !== '') raw.root = root
    if (stood !== '') raw.stood = stood
    if (input.run_in_background === true || typeof result.backgroundTaskId === 'string') raw.isBackground = true
    if (result.interrupted === true) raw.isInterrupted = true
  }

  // The result carries the file as it was; a new file has none.
  const before = text(result, 'originalFile')

  if (tool === 'Edit' || tool === 'NotebookEdit') {
    raw.oldText = text(input, 'old_string') ?? ''
    raw.newText = text(input, 'new_string') ?? text(input, 'new_source') ?? ''
    if (before !== undefined) raw.before = before
  }

  if (tool === 'Write') {
    raw.oldText = before ?? ''
    raw.newText = text(input, 'content') ?? ''
    if (before !== undefined) raw.before = before
  }

  if (ran.text !== undefined) raw.text = ran.text
  if (ran.isError === true) raw.isError = true

  return raw
}

export function appendRecord(list: readonly ToolRecord[], raw: RawCall, turn: number, at: number): ToolRecord[] {
  const id = (list.at(-1)?.id ?? 0) + 1

  return [...list, makeRecord(raw, id, turn, at)].slice(-RECORDS_KEPT)
}

/** A new prompt: the next turn. `isOwn` marks a prompt this mod sent itself. */
export function nextMeta(meta: Meta, prompt: string, isOwn: boolean): Meta {
  return {
    ...meta,
    turn: meta.turn + 1,
    denies: 0,
    promptNumbers: isOwn
      ? meta.promptNumbers
      : [...meta.promptNumbers, ...extractNumbers(prompt)].slice(-PROMPT_NUMBERS_KEPT),
  }
}
