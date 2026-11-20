import { describe, expect, test } from 'vitest'
import { parseDuration } from '../src/duration.js'

describe('parseDuration', () => {
  test('seconds', () => { expect(parseDuration('45s')).toBe(45) })
  test('hours', () => { expect(parseDuration('2h')).toBe(7200) })
  test('minutes over an hour', () => { expect(parseDuration('90m')).toBe(5400) })
  test('hours and minutes', () => { expect(parseDuration('1h30m')).toBe(5400) })
  test('all three, with spaces', () => { expect(parseDuration('1h 5m 10s')).toBe(3910) })
  test('zero', () => { expect(parseDuration('0s')).toBe(0) })
  test('rejects empty text', () => { expect(() => parseDuration('')).toThrow() })
  test('rejects words', () => { expect(() => parseDuration('abc')).toThrow() })
  test('rejects an unknown unit', () => { expect(() => parseDuration('1x')).toThrow() })
  test('rejects a unit given twice', () => { expect(() => parseDuration('1h1h')).toThrow() })
  test('rejects units in the wrong order', () => { expect(() => parseDuration('30m1h')).toThrow() })
  test('rejects text around the duration', () => { expect(() => parseDuration('about 1h')).toThrow() })
})
