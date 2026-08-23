import { describe, expect, it } from 'vitest'
import type { CustomFieldDef } from '@/lib/supabase/types'
import { validateCustomFields, toFieldErrors, CF_ERROR_PREFIX } from './validate'

/** Build a minimal active def with sane defaults. */
function def(over: Partial<CustomFieldDef>): CustomFieldDef {
  return {
    id: 'd1',
    entity_type: 'lead',
    key: 'k',
    label: 'K',
    field_type: 'short_text',
    required: false,
    options: [],
    display_order: 0,
    active: true,
    created_at: '2026-08-22T00:00:00Z',
    updated_at: '2026-08-22T00:00:00Z',
    ...over,
  }
}

describe('validateCustomFields', () => {
  it('omits optional blank values and reports ok', () => {
    const defs = [def({ key: 'note', label: 'Note', field_type: 'short_text' })]
    const r = validateCustomFields('lead', defs, { note: '   ' })
    expect(r.ok).toBe(true)
    expect(r.values).toEqual({})
  })

  it('errors on a required missing value', () => {
    const defs = [def({ key: 'cohort', label: 'Cohort', required: true })]
    const r = validateCustomFields('lead', defs, {})
    expect(r.ok).toBe(false)
    expect(r.errors.cohort).toMatch(/required/i)
  })

  it('trims and stores short_text', () => {
    const defs = [def({ key: 'ref', label: 'Ref' })]
    const r = validateCustomFields('lead', defs, { ref: '  MH-1 ' })
    expect(r).toMatchObject({ ok: true, values: { ref: 'MH-1' } })
  })

  it('coerces number and rejects NaN', () => {
    const defs = [def({ key: 'seats', label: 'Seats', field_type: 'number' })]
    expect(validateCustomFields('lead', defs, { seats: '3' })).toMatchObject({
      ok: true,
      values: { seats: 3 },
    })
    const bad = validateCustomFields('lead', defs, { seats: 'x' })
    expect(bad.ok).toBe(false)
    expect(bad.errors.seats).toMatch(/number/i)
  })

  it('validates dropdown/radio against option values', () => {
    const defs = [
      def({
        key: 'tier',
        label: 'Tier',
        field_type: 'dropdown',
        options: [
          { label: 'Gold', value: 'gold' },
          { label: 'Silver', value: 'silver' },
        ],
      }),
    ]
    expect(validateCustomFields('lead', defs, { tier: 'gold' }).ok).toBe(true)
    const bad = validateCustomFields('lead', defs, { tier: 'bronze' })
    expect(bad.ok).toBe(false)
    expect(bad.errors.tier).toMatch(/valid option/i)
  })

  it('normalises checkbox_group and validates members; empty = unset', () => {
    const defs = [
      def({
        key: 'ch',
        label: 'Channels',
        field_type: 'checkbox_group',
        options: [
          { label: 'Email', value: 'email' },
          { label: 'WhatsApp', value: 'whatsapp' },
        ],
      }),
    ]
    expect(
      validateCustomFields('lead', defs, { ch: 'email' })
    ).toMatchObject({ ok: true, values: { ch: ['email'] } })
    expect(validateCustomFields('lead', defs, { ch: [] })).toMatchObject({
      ok: true,
      values: {},
    })
    const bad = validateCustomFields('lead', defs, { ch: ['email', 'sms'] })
    expect(bad.ok).toBe(false)
  })

  it('validates date format', () => {
    const defs = [def({ key: 'd', label: 'When', field_type: 'date' })]
    expect(
      validateCustomFields('lead', defs, { d: '2026-09-01' })
    ).toMatchObject({ ok: true, values: { d: '2026-09-01' } })
    expect(validateCustomFields('lead', defs, { d: '01/09/2026' }).ok).toBe(
      false
    )
    expect(validateCustomFields('lead', defs, { d: '2026-13-40' }).ok).toBe(
      false
    )
  })

  it('coerces yes_no from booleans and strings', () => {
    const defs = [def({ key: 'y', label: 'Scholarship?', field_type: 'yes_no' })]
    expect(validateCustomFields('lead', defs, { y: 'on' })).toMatchObject({
      ok: true,
      values: { y: true },
    })
    expect(validateCustomFields('lead', defs, { y: false })).toMatchObject({
      ok: true,
      values: { y: false },
    })
  })

  it('requires explicit true for a required yes_no', () => {
    const defs = [
      def({ key: 'y', label: 'Consent', field_type: 'yes_no', required: true }),
    ]
    expect(validateCustomFields('lead', defs, { y: false }).ok).toBe(false)
    expect(validateCustomFields('lead', defs, { y: true }).ok).toBe(true)
  })

  it('drops unknown keys', () => {
    const defs = [def({ key: 'ref', label: 'Ref' })]
    const r = validateCustomFields('lead', defs, { ref: 'a', ghost: 'b' })
    expect(r.values).toEqual({ ref: 'a' })
  })

  it('returns partial values alongside errors', () => {
    const defs = [
      def({ key: 'ref', label: 'Ref' }),
      def({ key: 'n', label: 'N', field_type: 'number' }),
    ]
    const r = validateCustomFields('lead', defs, { ref: 'ok', n: 'x' })
    expect(r.ok).toBe(false)
    expect(r.values).toEqual({ ref: 'ok' })
    expect(r.errors.n).toBeTruthy()
  })
})

describe('toFieldErrors', () => {
  it('prefixes keys and wraps messages in arrays', () => {
    expect(toFieldErrors({ n: 'bad' })).toEqual({
      [`${CF_ERROR_PREFIX}n`]: ['bad'],
    })
  })
})
