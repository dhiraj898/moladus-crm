import { describe, it, expect } from 'vitest'
import { evaluateCondition } from './conditions'

/**
 * Unit tests for the pure condition evaluator (plan Task 2.1 / design §5).
 *
 * A condition is a single `{field, op, value}` predicate evaluated against a
 * context object (form answers for entry rules, the deal row for SLA rules).
 * A NULL condition is the always-matches fallback. `value` is unused for
 * `is_empty`/`not_empty` and an array for `in`/`not_in`. eq/neq compare via
 * `String()` so a numeric answer and a string config value still match.
 */
describe('evaluateCondition', () => {
  it('null condition always matches', () => {
    expect(evaluateCondition(null, {})).toBe(true)
    expect(evaluateCondition(null, { a: 'anything' })).toBe(true)
  })

  it('eq: true when equal, false when not', () => {
    expect(evaluateCondition({ field: 'a', op: 'eq', value: 'x' }, { a: 'x' })).toBe(true)
    expect(evaluateCondition({ field: 'a', op: 'eq', value: 'x' }, { a: 'y' })).toBe(false)
  })

  it('eq: string-compares across number/string types', () => {
    expect(evaluateCondition({ field: 'a', op: 'eq', value: '5' }, { a: 5 })).toBe(true)
    expect(evaluateCondition({ field: 'a', op: 'eq', value: 5 }, { a: '5' })).toBe(true)
  })

  it('neq: true when different, false when equal', () => {
    expect(evaluateCondition({ field: 'a', op: 'neq', value: 'x' }, { a: 'y' })).toBe(true)
    expect(evaluateCondition({ field: 'a', op: 'neq', value: 'x' }, { a: 'x' })).toBe(false)
  })

  it('in: true when the value is a member, false when not', () => {
    expect(evaluateCondition({ field: 'a', op: 'in', value: ['x', 'y'] }, { a: 'y' })).toBe(true)
    expect(evaluateCondition({ field: 'a', op: 'in', value: ['x', 'y'] }, { a: 'z' })).toBe(false)
  })

  it('not_in: true when absent from the set, false when present', () => {
    expect(evaluateCondition({ field: 'a', op: 'not_in', value: ['x', 'y'] }, { a: 'z' })).toBe(true)
    expect(evaluateCondition({ field: 'a', op: 'not_in', value: ['x', 'y'] }, { a: 'x' })).toBe(false)
  })

  it('in/not_in: non-array value is treated as an empty set', () => {
    expect(evaluateCondition({ field: 'a', op: 'in', value: 'x' }, { a: 'x' })).toBe(false)
    expect(evaluateCondition({ field: 'a', op: 'not_in', value: 'x' }, { a: 'x' })).toBe(true)
  })

  it('is_empty: true for missing, null, empty string, empty array', () => {
    expect(evaluateCondition({ field: 'a', op: 'is_empty' }, {})).toBe(true)
    expect(evaluateCondition({ field: 'a', op: 'is_empty' }, { a: null })).toBe(true)
    expect(evaluateCondition({ field: 'a', op: 'is_empty' }, { a: '' })).toBe(true)
    expect(evaluateCondition({ field: 'a', op: 'is_empty' }, { a: [] })).toBe(true)
  })

  it('is_empty: false for a present non-empty value', () => {
    expect(evaluateCondition({ field: 'a', op: 'is_empty' }, { a: 'x' })).toBe(false)
    expect(evaluateCondition({ field: 'a', op: 'is_empty' }, { a: ['x'] })).toBe(false)
    expect(evaluateCondition({ field: 'a', op: 'is_empty' }, { a: 0 })).toBe(false)
  })

  it('not_empty: the inverse of is_empty', () => {
    expect(evaluateCondition({ field: 'a', op: 'not_empty' }, { a: 'x' })).toBe(true)
    expect(evaluateCondition({ field: 'a', op: 'not_empty' }, {})).toBe(false)
    expect(evaluateCondition({ field: 'a', op: 'not_empty' }, { a: '' })).toBe(false)
  })

  it('missing field: eq is false, neq is true', () => {
    expect(evaluateCondition({ field: 'z', op: 'eq', value: 'x' }, {})).toBe(false)
    expect(evaluateCondition({ field: 'z', op: 'neq', value: 'x' }, {})).toBe(true)
  })
})
