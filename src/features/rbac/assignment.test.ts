import { describe, it, expect } from 'vitest'
import { pickRoundRobin } from './assignment'

/**
 * Unit tests for the pure round-robin picker (plan Task 3.1 / spec §9.1).
 * Given a stable, ordered pool and the cursor (last-assigned id), return the
 * next id, wrapping around. A null/absent cursor starts at the first id.
 */
describe('pickRoundRobin', () => {
  const pool = ['a', 'b', 'c']

  it('empty pool → null', () => {
    expect(pickRoundRobin([], null)).toBeNull()
    expect(pickRoundRobin([], 'a')).toBeNull()
  })

  it('null cursor → first', () => {
    expect(pickRoundRobin(pool, null)).toBe('a')
  })

  it('middle cursor → next', () => {
    expect(pickRoundRobin(pool, 'a')).toBe('b')
    expect(pickRoundRobin(pool, 'b')).toBe('c')
  })

  it('last cursor → wraps to first', () => {
    expect(pickRoundRobin(pool, 'c')).toBe('a')
  })

  it('cursor no longer in pool → first', () => {
    expect(pickRoundRobin(pool, 'z')).toBe('a')
  })

  it('single-member pool → that member', () => {
    expect(pickRoundRobin(['only'], 'only')).toBe('only')
    expect(pickRoundRobin(['only'], null)).toBe('only')
  })
})
