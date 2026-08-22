import { describe, expect, it } from 'vitest'
import type { FormField, VisibleWhen } from '@/lib/supabase/types'
import { isFieldVisible, visibleFields } from './visibility'

/**
 * Tests for the pure conditional-logic evaluator (plan Task 6.1).
 * Covers eq/neq/in/not_in (true + false), null rule, and missing-answer
 * semantics (hidden for eq/in, visible for neq/not_in).
 */

/** Build a minimal field carrying only a visibility rule. */
function field(visible_when: VisibleWhen | null): FormField {
  return {
    id: 'f1',
    form_id: 'form1',
    key: 'target',
    label: 'Target',
    field_type: 'short_text',
    required: true,
    display_order: 0,
    options: null,
    placeholder: null,
    binding: null,
    transform: null,
    visible_when,
  }
}

describe('isFieldVisible', () => {
  it('is visible when the rule is null', () => {
    expect(isFieldVisible(field(null), {})).toBe(true)
    expect(isFieldVisible(field(null), { anything: 'x' })).toBe(true)
  })

  describe('eq', () => {
    const rule: VisibleWhen = { field_key: 'plan', operator: 'eq', value: 'pro' }
    it('is visible when the answer equals the value', () => {
      expect(isFieldVisible(field(rule), { plan: 'pro' })).toBe(true)
    })
    it('is hidden when the answer differs', () => {
      expect(isFieldVisible(field(rule), { plan: 'free' })).toBe(false)
    })
    it('is hidden when the referenced answer is missing', () => {
      expect(isFieldVisible(field(rule), {})).toBe(false)
    })
  })

  describe('neq', () => {
    const rule: VisibleWhen = {
      field_key: 'plan',
      operator: 'neq',
      value: 'free',
    }
    it('is visible when the answer differs', () => {
      expect(isFieldVisible(field(rule), { plan: 'pro' })).toBe(true)
    })
    it('is hidden when the answer equals the value', () => {
      expect(isFieldVisible(field(rule), { plan: 'free' })).toBe(false)
    })
    it('is visible when the referenced answer is missing', () => {
      expect(isFieldVisible(field(rule), {})).toBe(true)
    })
  })

  describe('in', () => {
    const rule: VisibleWhen = {
      field_key: 'state',
      operator: 'in',
      value: ['MH', 'KA'],
    }
    it('is visible when the answer is in the set', () => {
      expect(isFieldVisible(field(rule), { state: 'KA' })).toBe(true)
    })
    it('is hidden when the answer is outside the set', () => {
      expect(isFieldVisible(field(rule), { state: 'TN' })).toBe(false)
    })
    it('is hidden when the referenced answer is missing', () => {
      expect(isFieldVisible(field(rule), {})).toBe(false)
    })
    it('matches when any selected checkbox value is in the set', () => {
      expect(isFieldVisible(field(rule), { state: ['TN', 'MH'] })).toBe(true)
    })
  })

  describe('not_in', () => {
    const rule: VisibleWhen = {
      field_key: 'state',
      operator: 'not_in',
      value: ['MH', 'KA'],
    }
    it('is visible when the answer is outside the set', () => {
      expect(isFieldVisible(field(rule), { state: 'TN' })).toBe(true)
    })
    it('is hidden when the answer is in the set', () => {
      expect(isFieldVisible(field(rule), { state: 'MH' })).toBe(false)
    })
    it('is visible when the referenced answer is missing', () => {
      expect(isFieldVisible(field(rule), {})).toBe(true)
    })
  })

  it('treats an empty string / empty array as a missing answer', () => {
    const eq: VisibleWhen = { field_key: 'plan', operator: 'eq', value: 'pro' }
    expect(isFieldVisible(field(eq), { plan: '' })).toBe(false)
    const inRule: VisibleWhen = {
      field_key: 'state',
      operator: 'in',
      value: ['MH'],
    }
    expect(isFieldVisible(field(inRule), { state: [] })).toBe(false)
  })
})

describe('visibleFields', () => {
  it('keeps always-visible fields and preserves order', () => {
    const fields = [field(null), field(null)]
    expect(visibleFields(fields, {})).toHaveLength(2)
  })

  it('drops fields whose rule evaluates hidden', () => {
    const shown = field(null)
    const hidden = field({ field_key: 'plan', operator: 'eq', value: 'pro' })
    const result = visibleFields([shown, hidden], { plan: 'free' })
    expect(result).toEqual([shown])
  })

  it('re-includes a field once its dependency is answered', () => {
    const gated = field({ field_key: 'plan', operator: 'eq', value: 'pro' })
    expect(visibleFields([gated], {})).toEqual([])
    expect(visibleFields([gated], { plan: 'pro' })).toEqual([gated])
  })
})
