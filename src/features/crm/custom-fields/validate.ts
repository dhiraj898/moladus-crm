import type {
  CustomFieldDef,
  CustomFieldEntity,
  CustomFieldValues,
} from '@/lib/supabase/types'

/**
 * Validation + coercion for entity custom fields (spec §5). Pure and
 * dependency-free so it can run in server actions and unit tests. The caller
 * passes the ACTIVE defs for an entity; unknown input keys are dropped.
 */

/** Prefix under which custom-field errors ride an action's `fieldErrors`. */
export const CF_ERROR_PREFIX = 'cf:'

const MAX_SHORT = 500
const MAX_LONG = 5000

export type CustomFieldValidationResult =
  | { ok: true; values: CustomFieldValues; errors: Record<string, string> }
  | { ok: false; values: CustomFieldValues; errors: Record<string, string> }

/** '' / null / undefined / [] all count as "not provided". */
function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (typeof v === 'string') return v.trim().length === 0
  if (Array.isArray(v)) return v.length === 0
  return false
}

const TRUE_STRINGS = new Set(['true', 'on', 'yes', '1'])
const FALSE_STRINGS = new Set(['false', 'off', 'no', '0', ''])

function isRealDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const d = new Date(iso + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

export function validateCustomFields(
  _entityType: CustomFieldEntity,
  defs: CustomFieldDef[],
  input: Record<string, unknown>
): CustomFieldValidationResult {
  const values: CustomFieldValues = {}
  const errors: Record<string, string> = {}

  for (const def of defs) {
    const raw = input[def.key]
    const empty = isEmpty(raw)

    if (empty) {
      if (def.required) errors[def.key] = `${def.label} is required.`
      continue // optional-blank → omit
    }

    switch (def.field_type) {
      case 'short_text':
      case 'long_text': {
        const s = String(raw).trim()
        const max = def.field_type === 'short_text' ? MAX_SHORT : MAX_LONG
        if (s.length > max) errors[def.key] = `${def.label} is too long.`
        else values[def.key] = s
        break
      }
      case 'number': {
        const n = Number(String(raw).trim())
        if (Number.isNaN(n)) errors[def.key] = `${def.label} must be a number.`
        else values[def.key] = n
        break
      }
      case 'dropdown':
      case 'radio': {
        const s = String(raw)
        const valid = def.options.some((o) => o.value === s)
        if (!valid) errors[def.key] = `Select a valid option for ${def.label}.`
        else values[def.key] = s
        break
      }
      case 'checkbox_group': {
        const arr = (Array.isArray(raw) ? raw : [raw]).map((x) => String(x))
        const allowed = new Set(def.options.map((o) => o.value))
        const bad = arr.some((x) => !allowed.has(x))
        if (bad) errors[def.key] = `Select valid options for ${def.label}.`
        else values[def.key] = arr
        break
      }
      case 'date': {
        const s = String(raw).trim()
        if (!isRealDate(s)) errors[def.key] = `Enter a valid date for ${def.label}.`
        else values[def.key] = s
        break
      }
      case 'yes_no': {
        let b: boolean | null = null
        if (typeof raw === 'boolean') b = raw
        else {
          const s = String(raw).trim().toLowerCase()
          if (TRUE_STRINGS.has(s)) b = true
          else if (FALSE_STRINGS.has(s)) b = false
        }
        if (b === null) errors[def.key] = `${def.label} must be yes or no.`
        else if (def.required && b !== true)
          errors[def.key] = `${def.label} is required.`
        else values[def.key] = b
        break
      }
    }
  }

  const ok = Object.keys(errors).length === 0
  return ok ? { ok: true, values, errors } : { ok: false, values, errors }
}

/** Map { key: msg } → { `cf:${key}`: [msg] } for an action's `fieldErrors`. */
export function toFieldErrors(
  errors: Record<string, string>
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(errors).map(([k, v]) => [`${CF_ERROR_PREFIX}${k}`, [v]])
  )
}
