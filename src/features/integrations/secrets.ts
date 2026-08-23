import 'server-only'
import { getEnv } from '@/lib/env'
import { getServiceClient } from '@/lib/supabase/server'
import { decryptSecret } from './crypto'
import type { SecretKey } from '@/lib/supabase/types'

/**
 * Secret resolver for the integration-settings store (Spec A, Task 2.1).
 *
 * Resolution order for a managed provider secret:
 *   1. The encrypted DB override in `integration_settings` (decrypted with the
 *      app master key). This lets an operator rotate a secret from the admin UI
 *      without a redeploy.
 *   2. The `.env` value (still validated by `@/lib/env`) as a fallback so a
 *      deployment keeps working before any DB override is entered, or if the DB
 *      lookup / decrypt fails.
 *   3. `undefined` when neither source has it — callers fail soft or 503.
 *
 * Any DB or decrypt failure is swallowed and logged server-side; we fall back to
 * env rather than letting a transient store error break payments or webhooks.
 * The decrypted value is never cached and never leaves the server.
 */
export async function getSecret(key: SecretKey): Promise<string | undefined> {
  try {
    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('integration_settings')
      .select('value_enc')
      .eq('key', key)
      .maybeSingle()

    if (error) {
      console.error(`[getSecret] DB lookup failed for ${key}; falling back to env`, error)
    } else if (data?.value_enc) {
      try {
        return decryptSecret(data.value_enc)
      } catch (err) {
        console.error(`[getSecret] decrypt failed for ${key}; falling back to env`, err)
      }
    }
  } catch (err) {
    console.error(`[getSecret] resolver error for ${key}; falling back to env`, err)
  }

  return getEnv()[key]
}
