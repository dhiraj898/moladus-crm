import { describe, expect, it } from 'vitest'
import type { AnswersMap } from '@/features/form-engine/visibility'
import type {
  Binding,
  FieldTransform,
  FieldType,
  FormField,
  VisibleWhen,
} from '@/lib/supabase/types'
import { applyBindings, validateAnswers } from './bind'

/**
 * Tests for the ingest binding + validation helpers (plan Task 10.1).
 *
 * Covers: contact/lead binding routing; store_only routing; hidden required
 * fields are NOT required; `string` transform coerces a numeric phone to a
 * String; a missing VISIBLE required field produces an error.
 */

let idCounter = 0

/** Build a FormField with sensible defaults, overridable per test. */
function field(overrides: Partial<FormField> = {}): FormField {
  idCounter += 1
  return {
    id: `f${idCounter}`,
    form_id: 'form1',
    key: `field_${idCounter}`,
    label: `Field ${idCounter}`,
    field_type: 'short_text' as FieldType,
    required: true,
    display_order: idCounter,
    options: null,
    placeholder: null,
    binding: null as Binding | null,
    transform: null as FieldTransform | null,
    visible_when: null as VisibleWhen | null,
    ...overrides,
  }
}

describe('applyBindings', () => {
  it('routes contact and lead bindings to their columns', () => {
    const fields = [
      field({ key: 'name', binding: 'contact.name' }),
      field({ key: 'wa', binding: 'contact.whatsapp_number' }),
      field({ key: 'email', binding: 'contact.email' }),
      field({ key: 'st', binding: 'lead.state' }),
      field({ key: 'src', binding: 'lead.source' }),
    ]
    const answers: AnswersMap = {
      name: 'Asha Rao',
      wa: '919812345678',
      email: 'asha@example.com',
      st: 'MH',
      src: 'instagram',
    }

    const { contact, lead } = applyBindings(fields, answers)
    expect(contact.name).toBe('Asha Rao')
    expect(contact.whatsapp_number).toBe('919812345678')
    expect(contact.email).toBe('asha@example.com')
    expect(lead.state).toBe('MH')
    expect(lead.source).toBe('instagram')
  })

  it('routes store_only and unbound answers into storeOnly by key', () => {
    const fields = [
      field({ key: 'goal', binding: 'store_only' }),
      field({ key: 'notes', binding: null }),
    ]
    const answers: AnswersMap = { goal: 'IIT', notes: 'evening batch' }

    const { storeOnly, contact, lead } = applyBindings(fields, answers)
    expect(storeOnly).toEqual({ goal: 'IIT', notes: 'evening batch' })
    expect(contact).toEqual({})
    expect(lead).toEqual({})
  })

  it("coerces a numeric phone to a String under the 'string' transform", () => {
    const fields = [
      field({
        key: 'wa',
        binding: 'contact.whatsapp_number',
        transform: 'string',
      }),
    ]
    // A number arriving from a phone/number input.
    const answers: AnswersMap = { wa: 919812345678 }

    const { contact } = applyBindings(fields, answers)
    expect(contact.whatsapp_number).toBe('919812345678')
    expect(typeof contact.whatsapp_number).toBe('string')
  })

  it("coerces consent to a boolean under the 'boolean' transform", () => {
    const fields = [
      field({
        key: 'consent',
        field_type: 'yes_no',
        binding: 'contact.marketing_consent',
        transform: 'boolean',
      }),
    ]
    expect(
      applyBindings(fields, { consent: 'yes' }).contact.marketing_consent
    ).toBe(true)
    expect(
      applyBindings(fields, { consent: false }).contact.marketing_consent
    ).toBe(false)
  })

  it('strips hidden fields before binding (spoofed hidden answer ignored)', () => {
    const fields = [
      field({ key: 'has_referral', field_type: 'yes_no', binding: 'store_only' }),
      field({
        key: 'referral_code',
        binding: 'store_only',
        visible_when: { field_key: 'has_referral', operator: 'eq', value: 'yes' },
      }),
    ]
    // has_referral is "no", so referral_code is hidden — its spoofed answer
    // must not be bound.
    const answers: AnswersMap = {
      has_referral: 'no',
      referral_code: 'SPOOF',
    }

    const { storeOnly } = applyBindings(fields, answers)
    expect(storeOnly).toEqual({ has_referral: 'no' })
    expect(storeOnly.referral_code).toBeUndefined()
  })
})

describe('validateAnswers', () => {
  it('errors when a visible required field is missing', () => {
    const fields = [field({ key: 'name', required: true })]
    const result = validateAnswers(fields, {})
    expect(result.ok).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].key).toBe('name')
  })

  it('passes when all visible required fields are present', () => {
    const fields = [field({ key: 'name', required: true })]
    const result = validateAnswers(fields, { name: 'Asha' })
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('does NOT require a required field that is hidden', () => {
    const fields = [
      field({ key: 'has_referral', field_type: 'yes_no' }),
      field({
        key: 'referral_code',
        required: true,
        visible_when: { field_key: 'has_referral', operator: 'eq', value: 'yes' },
      }),
    ]
    // referral_code is required but hidden (has_referral !== 'yes') → no error.
    const result = validateAnswers(fields, { has_referral: 'no' })
    expect(result.ok).toBe(true)
  })

  it('does not require statement fields', () => {
    const fields = [field({ key: 'intro', field_type: 'statement', required: false })]
    expect(validateAnswers(fields, {}).ok).toBe(true)
  })

  it('treats a blank / whitespace-only answer as missing', () => {
    const fields = [field({ key: 'name', required: true })]
    expect(validateAnswers(fields, { name: '   ' }).ok).toBe(false)
  })
})
