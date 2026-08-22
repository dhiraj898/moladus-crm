import type { ConditionOp } from '@/lib/supabase/types'

/**
 * Shared UI primitives for the Automation editors — design-token class strings
 * and condition-value helpers. Kept in one module so the three client editors
 * (entry rules, stage actions, SLA rules) stay visually consistent with the
 * Stages editor without duplicating literals.
 */

export const inputClass =
  'rounded-[8px] border border-line bg-surface2 px-3 py-2 text-sm text-text outline-none transition-colors focus:border-accent'

export const labelClass =
  'text-xs font-semibold uppercase tracking-[0.12em] text-dim'

export const addButtonClass =
  'rounded-[8px] bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60'

export const linkButtonClass =
  'text-sm font-medium text-accent transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60'

export const dangerButtonClass =
  'text-sm font-medium text-dim transition-colors hover:text-red disabled:cursor-not-allowed disabled:opacity-40'

/** Operator choices for a condition predicate (mirrors `ConditionOp`). */
export const OP_OPTIONS: { value: ConditionOp; label: string }[] = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'in', label: 'is one of' },
  { value: 'not_in', label: 'is not one of' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'not_empty', label: 'is not empty' },
]

/** Whether an operator needs a value input (`is_empty`/`not_empty` do not). */
export function opTakesValue(op: ConditionOp): boolean {
  return op !== 'is_empty' && op !== 'not_empty'
}

/**
 * Turn a raw text input into a condition `value` for the given operator.
 * `in`/`not_in` become a trimmed, comma-split array; other ops stay a string.
 */
export function parseValueInput(op: ConditionOp, raw: string): unknown {
  if (op === 'in' || op === 'not_in') {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }
  return raw
}

/** Render a stored condition `value` back into an editable text string. */
export function valueToInput(op: ConditionOp, value: unknown): string {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ')
  return String(value)
}
