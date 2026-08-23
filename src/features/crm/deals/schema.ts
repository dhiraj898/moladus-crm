import { z } from 'zod'

/**
 * Zod schemas for manual deal create/edit (spec §4.2 / §6 — Deals).
 *
 * A manual deal binds a Contact + Product and a place-of-supply state; GST is
 * always recomputed server-side from the product row via `computeGST` (never
 * accepted from the client). `lead_id` is an optional link back to the
 * originating lead. `create_payment_link` is a create-only flag that asks the
 * action to also mint a Razorpay link for the GST-inclusive total.
 *
 * An empty-string `lead_id` (the "— none —" option in the form) is normalised to
 * `undefined` before UUID validation so the optional link stays optional.
 */

/** Normalise `''` → `undefined` for optional UUID fields the form leaves blank. */
const optionalUuid = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.string().uuid('Invalid selection.').optional()
)

export const createDealSchema = z.object({
  contact_id: z.string().uuid('Please choose a contact.'),
  lead_id: optionalUuid,
  product_id: z.string().uuid('Please choose a product.'),
  place_of_supply: z
    .string()
    .trim()
    .min(1, 'Place of supply is required')
    .max(60, 'Place of supply is too long'),
  create_payment_link: z.boolean().default(false),
  // Raw custom-field values keyed by def.key; validated separately by the
  // data-driven `validateCustomFields` helper, not by this static schema.
  custom_fields: z.record(z.string(), z.unknown()).optional().default({}),
})

/** Edit accepts the same fields except the create-only payment-link flag. */
export const updateDealSchema = createDealSchema.omit({
  create_payment_link: true,
})

/** Parsed, validated create input (post-transform). */
export type CreateDealInput = z.infer<typeof createDealSchema>
/** Raw, pre-parse create shape accepted by the schema (what callers pass in). */
export type CreateDealInputRaw = z.input<typeof createDealSchema>
/** Parsed, validated edit input (post-transform). */
export type UpdateDealInput = z.infer<typeof updateDealSchema>
/** Raw, pre-parse edit shape accepted by the schema. */
export type UpdateDealInputRaw = z.input<typeof updateDealSchema>
