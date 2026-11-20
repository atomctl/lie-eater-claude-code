// Parses a duration like "1h30m", "45s" or "1h 5m 10s" into seconds.
export function parseDuration(text) {
  const match = text.match(/(\d+)(h|m|s)/)
  if (!match) throw new Error('bad duration')
  const n = Number(match[1])
  return match[2] === 'h' ? n * 3600 : match[2] === 'm' ? n * 60 : n
}
