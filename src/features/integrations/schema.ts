import { z } from 'zod'

/**
 * Zod schema for setting an integration secret (Spec A, Task 3.1).
 *
 * `key` is constrained to the five managed provider secret keys (the
 * `SecretKey` union) so a caller can never write an arbitrary row into the
 * encrypted store. `value` is the raw plaintext secret to encrypt — required,
 * non-empty (an empty value would be a no-op masquerading as "set"; use
 * `clearSecret` to revert to the env fallback instead).
 */
export const secretInputSchema = z.object({
  key: z.enum([
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    'AISENSY_API_KEY',
    'AISENSY_WEBHOOK_SECRET',
  ]),
  value: z.string().min(1, 'Value is required'),
})

/** Parsed, validated secret input. */
export type SecretInput = z.infer<typeof secretInputSchema>
/** Raw, pre-parse shape accepted by the schema (what callers pass in). */
export type SecretInputRaw = z.input<typeof secretInputSchema>
