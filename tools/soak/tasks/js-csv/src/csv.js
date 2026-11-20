// Parses CSV text into rows of fields.
export function parseCsv(text) {
  return text.split('\n').map(line => line.split(','))
}
