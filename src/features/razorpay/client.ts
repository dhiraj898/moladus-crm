import 'server-only'
import Razorpay from 'razorpay'
import { getSecret } from '@/features/integrations/secrets'

/**
 * Server-only Razorpay client (spec §8).
 *
 * Instantiated with `key_id` + `key_secret` resolved via `getSecret` — the
 * encrypted DB override first, then env fallback (Spec A, Task 2.2). The secret
 * must never reach the browser bundle, so `import 'server-only'` makes any
 * client-side import a build error. The client is cached across invocations.
 */
let cached: Razorpay | null = null

export async function getRazorpayClient(): Promise<Razorpay> {
  if (cached) return cached
  const keyId = await getSecret('RAZORPAY_KEY_ID')
  const keySecret = await getSecret('RAZORPAY_KEY_SECRET')
  if (!keyId || !keySecret) {
    throw new Error('Razorpay credentials are not configured')
  }
  cached = new Razorpay({ key_id: keyId, key_secret: keySecret })
  return cached
}
