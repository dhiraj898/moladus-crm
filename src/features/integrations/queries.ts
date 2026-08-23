import 'server-only'
import { getEnv } from '@/lib/env'
import { getServiceClient } from '@/lib/supabase/server'
import type { SecretKey } from '@/lib/supabase/types'

/**
 * Server-only status reads for the integration-settings store (Spec A, Task 3.1).
 *
 * This module is `server-only`, so it is never exposed as a client-invocable
 * Server Action endpoint (unlike the `'use server'` module in `actions.ts`).
 * The settings page (gated by `settings.view` via `requireModuleView`) imports
 * `getIntegrationStatus` directly.
 *
 * SECURITY: this NEVER returns a secret value — only whether each key is set and
 * from which source (`db` override, `env` fallback, or `none`). Decrypted
 * plaintext lives only inside `getSecret` (the provider-code resolver) and never
 * reaches this status surface or the browser.
 */

/** The five managed provider secret keys, in display order (Razorpay, AiSensy). */
export const SECRET_KEYS: readonly SecretKey[] = [
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'AISENSY_API_KEY',
  'AISENSY_WEBHOOK_SECRET',
] as const

/** Masked status for one managed secret — booleans + source only, never a value. */
export interface IntegrationStatus {
  key: SecretKey
  isSet: boolean
  source: 'db' | 'env' | 'none'
  updatedAt: string | null
}

/**
 * Report the status of every managed secret. For each key, a DB override (row in
 * `integration_settings`) takes precedence and reports `source: 'db'` with its
 * `updated_at`; otherwise a non-empty env value reports `source: 'env'`; when
 * neither is present the key is `not set` (`source: 'none'`).
 *
 * A single query loads all DB rows (there are at most five) rather than one
 * round-trip per key. A DB error is swallowed and treated as "no override",
 * degrading to the env view rather than breaking the settings page render.
 */
export async function getIntegrationStatus(): Promise<IntegrationStatus[]> {
  const dbByKey = new Map<string, string>()
  try {
    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('integration_settings')
      .select('key, updated_at')

    if (error) {
      console.error('[getIntegrationStatus] DB lookup failed; showing env-only status', error)
    } else {
      for (const row of data ?? []) {
        const r = row as { key: string; updated_at: string }
        dbByKey.set(r.key, r.updated_at)
      }
    }
  } catch (err) {
    console.error('[getIntegrationStatus] resolver error; showing env-only status', err)
  }

  const env = getEnv()

  return SECRET_KEYS.map((key) => {
    if (dbByKey.has(key)) {
      return { key, isSet: true, source: 'db', updatedAt: dbByKey.get(key) ?? null }
    }
    if (env[key]) {
      return { key, isSet: true, source: 'env', updatedAt: null }
    }
    return { key, isSet: false, source: 'none', updatedAt: null }
  })
}
