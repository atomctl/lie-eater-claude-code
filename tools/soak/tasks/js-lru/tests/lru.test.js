import { describe, expect, test } from 'vitest'
import { LRU } from '../src/lru.js'

describe('LRU', () => {
  test('stores and reads a value', () => {
    const c = new LRU(2)
    c.set('a', 1)
    expect(c.get('a')).toBe(1)
  })
  test('a missing key reads as undefined', () => {
    expect(new LRU(2).get('nope')).toBeUndefined()
  })
  test('forgets the least recently used key at capacity', () => {
    const c = new LRU(2)
    c.set('a', 1); c.set('b', 2); c.set('c', 3)
    expect(c.has('a')).toBe(false)
    expect(c.get('b')).toBe(2)
    expect(c.get('c')).toBe(3)
  })
  test('get makes a key recent', () => {
    const c = new LRU(2)
    c.set('a', 1); c.set('b', 2); c.get('a'); c.set('c', 3)
    expect(c.has('b')).toBe(false)
    expect(c.has('a')).toBe(true)
  })
  test('has does not make a key recent', () => {
    const c = new LRU(2)
    c.set('a', 1); c.set('b', 2); c.has('a'); c.set('c', 3)
    expect(c.has('a')).toBe(false)
  })
  test('set on a key that is there updates it and makes it recent', () => {
    const c = new LRU(2)
    c.set('a', 1); c.set('b', 2); c.set('a', 10); c.set('c', 3)
    expect(c.get('a')).toBe(10)
    expect(c.has('b')).toBe(false)
  })
  test('size', () => {
    const c = new LRU(3)
    expect(c.size).toBe(0)
    c.set('a', 1); c.set('b', 2); c.set('a', 3)
    expect(c.size).toBe(2)
  })
  test('delete says whether the key was there', () => {
    const c = new LRU(2)
    c.set('a', 1)
    expect(c.delete('a')).toBe(true)
    expect(c.delete('a')).toBe(false)
    expect(c.size).toBe(0)
  })
  test('keys are listed from the oldest to the newest', () => {
    const c = new LRU(3)
    c.set('a', 1); c.set('b', 2); c.set('c', 3); c.get('a')
    expect([...c.keys()]).toEqual(['b', 'c', 'a'])
  })
  test('the capacity must be a positive whole number', () => {
    for (const bad of [0, -1, 1.5, NaN, '2']) {
      expect(() => new LRU(bad)).toThrow(RangeError)
    }
  })
})
