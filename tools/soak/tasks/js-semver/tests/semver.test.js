import { describe, expect, test } from 'vitest'
import { compare } from '../src/semver.js'

const CHAIN = [
  '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta',
  '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0',
]

describe('compare', () => {
  test('equal versions', () => { expect(compare('1.2.3', '1.2.3')).toBe(0) })
  test('patch', () => { expect(compare('1.2.3', '1.2.4')).toBe(-1) })
  test('major wins', () => { expect(compare('2.0.0', '1.9.9')).toBe(1) })
  test('numbers, not text', () => { expect(compare('1.10.0', '1.9.0')).toBe(1) })
  test('a pre-release comes before its release', () => { expect(compare('1.0.0-alpha', '1.0.0')).toBe(-1) })
  test('the pre-release order of the semver text', () => {
    for (let i = 0; i < CHAIN.length - 1; i += 1) {
      expect(`${CHAIN[i]} < ${CHAIN[i + 1]}: ${compare(CHAIN[i], CHAIN[i + 1])}`).toBe(`${CHAIN[i]} < ${CHAIN[i + 1]}: -1`)
      expect(compare(CHAIN[i + 1], CHAIN[i])).toBe(1)
    }
  })
  test('sorting with it', () => {
    expect([...CHAIN].reverse().sort(compare)).toEqual(CHAIN)
  })
  test('build data is ignored', () => { expect(compare('1.0.0+build.1', '1.0.0+build.2')).toBe(0) })
  test('a bad version is a TypeError', () => {
    for (const bad of ['1.2', 'a.b.c', '01.2.3', '', '1.2.3-']) {
      expect(() => compare(bad, '1.0.0')).toThrow(TypeError)
    }
  })
})
