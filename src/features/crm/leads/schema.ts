import { z } from 'zod'

/**
 * Zod schemas for manual lead create/edit (spec §6 — Lead detail + create/edit).
 *
 * Leads normally arrive from the public form runner (with a `raw_payload`); a
 * manual lead is a thin, hand-entered record, so every field except `status` is
 * optional. Empty-string inputs from the form ("" for a blank field or the
 * "— none —" product option) are normalised to `undefined` before validation so
 * the optional fields stay optional, and are stored as `null`.
 */

/** Valid lead workflow statuses (mirrors `leads.status`; `new` is the default). */
export const LEAD_STATUSES = [
  'new',
  'contacted',
  'qualified',
  'converted',
  'lost',
] as const

/** Normalise `''` / `null` → `undefined` then apply an optional string schema. */
function optionalText(max: number) {
  return z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.string().trim().max(max, 'Too long').optional()
  )
}

/** Optional email: blank is allowed, but a present value must be a valid email. */
const optionalEmail = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.string().trim().email('Enter a valid email address.').max(160).optional()
)

/** Optional UUID (the "— none —" product option submits ''). */
const optionalUuid = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.string().uuid('Invalid selection.').optional()
)

export const leadSchema = z.object({
  name: optionalText(120),
  email: optionalEmail,
  phone: optionalText(40),
  state: optionalText(60),
  source: optionalText(120),
  status: z.enum(LEAD_STATUSES).default('new'),
  product_id: optionalUuid,
  // Raw custom-field values keyed by def.key; validated separately by the
  // data-driven `validateCustomFields` helper, not by this static schema.
  custom_fields: z.record(z.string(), z.unknown()).optional().default({}),
})

/** Raw, pre-parse shape accepted by the schema (what callers pass in). */
export type LeadInputRaw = z.input<typeof leadSchema>
/** Parsed, validated lead input (post-transform). */
export type LeadInput = z.infer<typeof leadSchema>
