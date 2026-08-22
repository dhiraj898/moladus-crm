import type { Condition } from '@/lib/supabase/types'

/**
 * Pure condition evaluator (design §5, decision §3.5).
 *
 * A `Condition` is a single `{field, op, value}` predicate — nested AND/OR
 * groups are out of scope for v1. It is evaluated against a plain context
 * object: form answers for entry routing, or the deal row for SLA rules. The
 * function has no I/O and no dependencies beyond the type, so it is trivially
 * unit-tested and safe to call from any layer.
 *
 * Semantics:
 * - `null` condition → always matches (the fallback rule).
 * - a value is "empty" when it is `undefined`, `null`, `''`, or `[]`.
 * - `eq`/`neq` compare with `String()` so a numeric answer (`5`) matches a
 *   string config value (`'5'`), tolerating form/JSON type drift.
 * - `in`/`not_in` treat `value` as an array; a non-array `value` is an empty
 *   set (so `in` is false, `not_in` is true).
 */
export function evaluateCondition(
  cond: Condition | null,
  ctx: Record<string, unknown>,
): boolean {
  if (cond === null) return true

  const actual = ctx[cond.field]

  switch (cond.op) {
    case 'eq':
      return String(actual) === String(cond.value)
    case 'neq':
      return String(actual) !== String(cond.value)
    case 'in':
      return Array.isArray(cond.value) && cond.value.some((v) => String(v) === String(actual))
    case 'not_in':
      return !(Array.isArray(cond.value) && cond.value.some((v) => String(v) === String(actual)))
    case 'is_empty':
      return isEmpty(actual)
    case 'not_empty':
      return !isEmpty(actual)
    default:
      return false
  }
}

/** A value is empty when undefined, null, an empty string, or an empty array. */
function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true
  if (Array.isArray(value) && value.length === 0) return true
  return false
}
