import type { Answer, AnswersMap } from '@/features/form-engine/visibility'
import { visibleFields } from '@/features/form-engine/visibility'
import type { Binding, FieldTransform, FormField } from '@/lib/supabase/types'

/**
 * Binding + validation for the ingest pipeline (spec §6 steps 5–7).
 *
 * Both entry points first strip HIDDEN fields via the shared server-side
 * visibility evaluator (`visibleFields`) so a spoofed answer for a
 * conditionally-hidden field can never be required, validated, or bound. This
 * mirrors the client navigation exactly (same pure evaluator) while trusting
 * nothing the browser sent.
 *
 * `validateAnswers` enforces required-ness on the VISIBLE field set.
 * `applyBindings` routes each visible, bound answer to its destination
 * (contact / lead / store-only), applying the field's declared transform.
 */

/** Contact columns an answer can bind to. */
export interface BoundContact {
  name?: string
  email?: string
  whatsapp_number?: string
  marketing_consent?: boolean
}

/** Lead columns an answer can bind to. */
export interface BoundLead {
  source?: string
  state?: string
}

/** Result of routing answers by their field bindings. */
export interface AppliedBindings {
  contact: BoundContact
  lead: BoundLead
  /** Answers for `store_only` fields, keyed by field key. */
  storeOnly: Record<string, Answer>
}

/** A single validation failure. */
export interface ValidationError {
  key: string
  message: string
}

/** Aggregate validation outcome. */
export interface ValidationResult {
  ok: boolean
  errors: ValidationError[]
}

/** True when an answer carries a usable value (not blank / unset). */
function isPresent(answer: Answer): boolean {
  if (answer === undefined || answer === null) return false
  if (typeof answer === 'string') return answer.trim().length > 0
  if (Array.isArray(answer)) return answer.length > 0
  return true // boolean / number are always "present"
}

/** Coerce a truthy-ish answer to a boolean (for yes/no + consent fields). */
function toBoolean(answer: Answer): boolean {
  if (typeof answer === 'boolean') return answer
  if (typeof answer === 'number') return answer !== 0
  if (typeof answer === 'string') {
    const v = answer.trim().toLowerCase()
    return v === 'true' || v === 'yes' || v === '1' || v === 'on'
  }
  if (Array.isArray(answer)) return answer.length > 0
  return false
}

/**
 * Apply a field's declared transform to an answer. `string` coerces any scalar
 * (e.g. a phone number typed as a number) to a String; `number` parses to a
 * finite number (falling back to the original on NaN); `boolean` uses
 * `toBoolean`. A `null` transform leaves the value untouched.
 */
function applyTransform(answer: Answer, transform: FieldTransform | null): Answer {
  if (answer === undefined || answer === null) return answer
  switch (transform) {
    case 'string':
      return typeof answer === 'string' ? answer : String(answer)
    case 'number': {
      const n = Number(answer)
      return Number.isFinite(n) ? n : answer
    }
    case 'boolean':
      return toBoolean(answer)
    default:
      return answer
  }
}

/** Coerce any answer to a trimmed string for a text-typed destination column. */
function toText(answer: Answer): string {
  if (typeof answer === 'string') return answer.trim()
  if (Array.isArray(answer)) return answer.join(', ')
  return String(answer)
}

/**
 * Validate answers against the VISIBLE required fields. Hidden fields (per the
 * shared visibility evaluator) are never required. `statement` fields collect no
 * answer and are skipped. Returns `{ ok, errors }` — `ok` is true iff no
 * required visible field is missing.
 */
export function validateAnswers(
  fields: FormField[],
  answers: AnswersMap
): ValidationResult {
  const visible = visibleFields(fields, answers)
  const errors: ValidationError[] = []

  for (const field of visible) {
    if (field.field_type === 'statement') continue
    if (!field.required) continue
    if (!isPresent(answers[field.key])) {
      errors.push({ key: field.key, message: `${field.label} is required` })
    }
  }

  return { ok: errors.length === 0, errors }
}

/** True when a binding targets a contact column. */
function isContactBinding(binding: Binding): boolean {
  return binding.startsWith('contact.')
}

/** True when a binding targets a lead column. */
function isLeadBinding(binding: Binding): boolean {
  return binding.startsWith('lead.')
}

/**
 * Route each visible, bound answer to its destination. Hidden fields are
 * stripped first so a spoofed hidden answer never reaches the DB. The field's
 * transform is applied before routing; destination columns then receive the
 * correctly-typed value (text columns as strings, `marketing_consent` as a
 * boolean). Unbound / `store_only` fields land in `storeOnly` keyed by key.
 */
export function applyBindings(
  fields: FormField[],
  answers: AnswersMap
): AppliedBindings {
  const visible = visibleFields(fields, answers)

  const contact: BoundContact = {}
  const lead: BoundLead = {}
  const storeOnly: Record<string, Answer> = {}

  for (const field of visible) {
    if (field.field_type === 'statement') continue

    const raw = answers[field.key]
    const value = applyTransform(raw, field.transform)
    const binding: Binding = field.binding ?? 'store_only'

    // store_only (explicit or unbound): keep the raw answer under its key.
    if (binding === 'store_only') {
      storeOnly[field.key] = raw
      continue
    }

    // A bound field with no usable answer contributes nothing.
    if (!isPresent(value)) continue

    if (isContactBinding(binding)) {
      switch (binding) {
        case 'contact.name':
          contact.name = toText(value)
          break
        case 'contact.email':
          contact.email = toText(value)
          break
        case 'contact.whatsapp_number':
          contact.whatsapp_number = toText(value)
          break
        case 'contact.marketing_consent':
          contact.marketing_consent = toBoolean(value)
          break
      }
    } else if (isLeadBinding(binding)) {
      switch (binding) {
        case 'lead.source':
          lead.source = toText(value)
          break
        case 'lead.state':
          lead.state = toText(value)
          break
      }
    }
  }

  return { contact, lead, storeOnly }
}
