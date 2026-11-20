// Number provenance: does a number the agent reports come from a tool output?
// Plain matching; no model. The result is a note for the person, never a verdict.
import type { ToolRecord } from '../../types'

// Words that make the next number a name, not a measurement.
const LABELS =
  'line|lines|step|version|python|node|port|issue|pr|page|section|task|call|chapter|figure|fig|table|code|status|http|id'

const NOT_MEASUREMENTS: RegExp[] = [
  /```[\s\S]*?```/g, // fenced code
  /`[^`\n]*`/g, // inline code
  /https?:\/\/\S+/g, // links
  /\S*\/\S*/g, // paths
  /\b[\w-]+\.[a-zA-Z]{1,5}\b/g, // file names
  /\b\d{4}-\d{2}-\d{2}\b/g, // dates
  /\bv?\d+\.\d+\.\d+[\w.-]*/g, // versions like 2.3.1
  /\bv\d+(\.\d+)?\b/g, // versions like v2
  /\b\d{1,2}:\d{2}(:\d{2})?\b/g, // times
  /^\s*\d+[.)]\s/gm, // list marks
  new RegExp(`(\\b(${LABELS})|#)\\s*\\d[\\d.]*`, 'gi'),
]

type Reported = { token: string; value: number; decimals: number; isPercent: boolean }

function reported(answer: string): Reported[] {
  const prose = NOT_MEASUREMENTS.reduce((text, pattern) => text.replace(pattern, ' '), answer)
  const found = new Map<string, Reported>()

  for (const m of prose.matchAll(/(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s?%)?/g)) {
    const digits = (m[1] ?? '').replaceAll(',', '')
    const decimals = digits.split('.')[1]?.length ?? 0
    const isPercent = m[2] !== undefined
    const value = Number(digits)

    // Small whole numbers are counts a person makes in the head ("3 files").
    if (decimals > 0 || isPercent || value >= 10) {
      const token = isPercent ? `${digits}%` : digits
      found.set(token, { token, value, decimals, isPercent })
    }
  }

  return [...found.values()]
}

const rounds = (source: number, to: Reported): boolean => Number(source.toFixed(to.decimals)) === to.value

// 0.8612 backs "0.86" and "86%"; 86.12 backs "86%" and "0.86". Only a source
// with decimals is turned into a percent or back: a lone `1` in some output
// must not back "100%" or "0.01".
function backs(source: string, r: Reported): boolean {
  const value = Number(source)

  if (rounds(value, r)) {
    return true
  }

  return source.includes('.') && (r.isPercent ? rounds(value * 100, r) : rounds(value / 100, r))
}

// shortcut: ratios ("3 times faster") and sums are not derived, add when a real session shows the need
export function checkNumbers(
  answer: string,
  records: readonly ToolRecord[],
  promptNumbers: readonly string[],
): { traced: number; fromNowhere: string[] } {
  const sources = records.flatMap(r => r.numbers)
  const fromPerson = new Set(promptNumbers.map(Number))
  const checked = reported(answer).filter(r => !fromPerson.has(r.value))
  const fromNowhere = checked.filter(r => !sources.some(source => backs(source, r))).map(r => r.token)

  return { traced: checked.length - fromNowhere.length, fromNowhere }
}
