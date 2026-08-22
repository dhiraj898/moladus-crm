import { z } from 'zod'

/**
 * Zod schema for product create/update input (spec §4 — Products).
 *
 * Sensible defaults per the plan: currency INR, gst 18, price_mode exclusive,
 * taxable + active true. GST is never hardcoded downstream — it is read from
 * the product row — so it is captured here as validated input.
 *
 * Optional text columns coerce empty strings to `null` so the DB stores NULL
 * rather than an empty string (matches the nullable columns in the DDL).
 */

/** Trim, then map an empty string to null for nullable text inputs. */
/**
 * Coerce a form value to a number, mapping blank/nullish to `undefined` so a
 * `.default()` can apply and empty inputs surface a clean "required" error
 * rather than being silently read as 0.
 */
function toNumberOrUndefined(v: unknown): number | undefined {
  if (v === '' || v === null || v === undefined) return undefined
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = Number(v.trim())
    return Number.isNaN(n) ? undefined : n
  }
  return undefined
}

const nullableText = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .default(null)

export const productSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  code: nullableText,
  sac_code: nullableText,
  description: nullableText,
  base_price: z.preprocess(
    toNumberOrUndefined,
    z
      .number({ invalid_type_error: 'Base price must be a number' })
      .nonnegative('Base price cannot be negative')
      .finite('Base price must be a valid amount')
  ),
  currency: z.string().trim().min(1).default('INR'),
  taxable: z.coerce.boolean().default(true),
  gst_percentage: z.preprocess(
    toNumberOrUndefined,
    z
      .number({ invalid_type_error: 'GST % must be a number' })
      .min(0, 'GST % cannot be negative')
      .max(100, 'GST % cannot exceed 100')
      .default(18)
  ),
  price_mode: z.enum(['inclusive', 'exclusive']).default('exclusive'),
  active: z.coerce.boolean().default(true),
})

/** Parsed, validated product input (post-transform). */
export type ProductInput = z.infer<typeof productSchema>
/** Raw, pre-parse shape accepted by the schema (what callers pass in). */
export type ProductInputRaw = z.input<typeof productSchema>
