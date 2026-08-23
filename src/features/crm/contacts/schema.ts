import { z } from 'zod'

/**
 * Zod schemas for manual contact create/edit (spec §6 — Contact detail +
 * create/edit).
 *
 * `whatsapp_number` is the required, unique identity of a contact (enforced by
 * the DB unique index; the action maps a collision to a friendly message).
 * Optional fields submitted blank ("" / the "— none —" lead option) are
 * normalised to `undefined` before validation and stored as `null`. `tags` is a
 * pre-split string array supplied by the form.
 */

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

/** Optional UUID (the "— none —" lead option submits ''). */
const optionalUuid = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.string().uuid('Invalid selection.').optional()
)

export const contactSchema = z.object({
  name: optionalText(120),
  email: optionalEmail,
  whatsapp_number: z
    .string()
    .trim()
    .min(1, 'WhatsApp number is required.')
    .max(20, 'WhatsApp number is too long.'),
  marketing_consent: z.boolean().default(false),
  lead_id: optionalUuid,
  tags: z.array(z.string().trim().min(1)).max(50).default([]),
  // Raw custom-field values keyed by def.key; validated separately by the
  // data-driven `validateCustomFields` helper, not by this static schema.
  custom_fields: z.record(z.string(), z.unknown()).optional().default({}),
})

/** Raw, pre-parse shape accepted by the schema (what callers pass in). */
export type ContactInputRaw = z.input<typeof contactSchema>
/** Parsed, validated contact input (post-transform). */
export type ContactInput = z.infer<typeof contactSchema>
