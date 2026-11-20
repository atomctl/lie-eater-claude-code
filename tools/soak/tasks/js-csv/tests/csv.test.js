import { describe, expect, test } from 'vitest'
import { parseCsv } from '../src/csv.js'

describe('parseCsv', () => {
  test('rows and fields', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']])
  })
  test('a last newline makes no empty row', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']])
  })
  test('Windows line ends', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([['a', 'b'], ['c', 'd']])
  })
  test('a comma inside quotes', () => {
    expect(parseCsv('a,"b,c",d')).toEqual([['a', 'b,c', 'd']])
  })
  test('a doubled quote inside quotes is one quote', () => {
    expect(parseCsv('a,"say ""hi""",c')).toEqual([['a', 'say "hi"', 'c']])
  })
  test('a newline inside quotes stays in the field', () => {
    expect(parseCsv('a,"line1\nline2",c\nx,y,z')).toEqual([['a', 'line1\nline2', 'c'], ['x', 'y', 'z']])
  })
  test('empty fields', () => {
    expect(parseCsv('a,,c\n,,')).toEqual([['a', '', 'c'], ['', '', '']])
  })
  test('empty text has no rows', () => {
    expect(parseCsv('')).toEqual([])
  })
  test('a quote that never closes is an error', () => {
    expect(() => parseCsv('a,"b')).toThrow()
  })
})
