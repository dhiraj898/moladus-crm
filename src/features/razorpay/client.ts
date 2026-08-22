import 'server-only'
import Razorpay from 'razorpay'
import { getEnv } from '@/lib/env'

/**
 * Server-only Razorpay client (spec §8).
 *
 * Instantiated with `key_id` + `key_secret` from validated env. The secret must
 * never reach the browser bundle, so `import 'server-only'` makes any
 * client-side import a build error. The client is cached across invocations.
 */
let cached: Razorpay | null = null

export function getRazorpayClient(): Razorpay {
  if (cached) return cached
  const env = getEnv()
  cached = new Razorpay({
    key_id: env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET,
  })
  return cached
}
