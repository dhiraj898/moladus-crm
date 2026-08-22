import type { FormField, VisibleWhen } from '@/lib/supabase/types'

/**
 * Pure conditional-logic evaluator for the public form (spec §5 — Conditional
 * Logic). Shared verbatim by the client FormRunner and the server ingest
 * pipeline so client navigation and server-side spoofing protection evaluate
 * rules identically.
 *
 * Rule shape (`form_fields.visible_when`): `{ field_key, operator, value }`.
 * A `null` rule means the field is always visible.
 *
 * Missing-answer semantics (per plan Task 6.1):
 *   - `eq` / `in`     → a missing referenced answer means the field is HIDDEN.
 *   - `neq` / `not_in`→ a missing referenced answer means the field is VISIBLE.
 * This mirrors set logic: "equals X" cannot hold with no answer, while "not
 * equal to X" trivially holds.
 */

/** A single collected answer. Choice groups produce string arrays. */
export type Answer = string | string[] | boolean | number | null | undefined

/** Map of `field.key` → collected answer. */
export type AnswersMap = Record<string, Answer>

/** True when an answer carries a usable value (not blank / unset). */
function isPresent(answer: Answer): boolean {
  if (answer === undefined || answer === null) return false
  if (typeof answer === 'string') return answer.length > 0
  if (Array.isArray(answer)) return answer.length > 0
  return true // boolean / number are always "present"
}

/** Compare an answer against a single expected value (eq / neq). */
function equals(answer: Answer, expected: string): boolean {
  if (Array.isArray(answer)) return answer.includes(expected)
  return String(answer) === expected
}

/** Test membership of an answer within an expected set (in / not_in). */
function memberOf(answer: Answer, expected: string[]): boolean {
  if (Array.isArray(answer)) return answer.some((a) => expected.includes(a))
  return expected.includes(String(answer))
}

/** Normalise a rule value to a single string (eq / neq operands). */
function asScalar(value: VisibleWhen['value']): string {
  return Array.isArray(value) ? (value[0] ?? '') : value
}

/** Normalise a rule value to a string array (in / not_in operands). */
function asArray(value: VisibleWhen['value']): string[] {
  return Array.isArray(value) ? value : [value]
}

/**
 * Evaluate one field's visibility against the collected answers. Fields with a
 * `null` rule are always visible.
 */
export function isFieldVisible(
  field: Pick<FormField, 'visible_when'>,
  answers: AnswersMap
): boolean {
  const rule = field.visible_when
  if (!rule) return true

  const answer = answers[rule.field_key]
  const present = isPresent(answer)

  switch (rule.operator) {
    case 'eq':
      return present && equals(answer, asScalar(rule.value))
    case 'neq':
      return !present || !equals(answer, asScalar(rule.value))
    case 'in':
      return present && memberOf(answer, asArray(rule.value))
    case 'not_in':
      return !present || !memberOf(answer, asArray(rule.value))
    default:
      // Unknown operator: fail safe to visible so no field is silently dropped.
      return true
  }
}

/**
 * Filter a field list down to those visible given the current answers,
 * preserving order. Used for navigation and progress in the client, and for
 * stripping hidden answers on the server.
 */
export function visibleFields<T extends Pick<FormField, 'visible_when'>>(
  fields: T[],
  answers: AnswersMap
): T[] {
  return fields.filter((field) => isFieldVisible(field, answers))
}
