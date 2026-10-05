import { describe, it, expect } from 'vitest'
import { buildBundleName } from './bundle'

describe('buildBundleName', () => {
  it('joins component names with + and appends the tier', () => {
    expect(buildBundleName(['A', 'B', 'C'], 'Elite')).toBe('A+B+C - Elite')
  })
  it('omits the dash when tier is blank', () => {
    expect(buildBundleName(['A', 'B'], '')).toBe('A+B')
  })
  it('returns the tier alone when no components', () => {
    expect(buildBundleName([], 'Pro')).toBe('Pro')
  })
})
