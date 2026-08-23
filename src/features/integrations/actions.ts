'use server'

import { revalidatePath } from 'next/cache'
import { getServiceClient } from '@/lib/supabase/server'
import { requirePermission } from '@/features/rbac/permissions'
import type { SecretKey } from '@/lib/supabase/types'
import { encryptSecret } from './crypto'
import { getSecret } from './secrets'
import { secretInputSchema, type SecretInputRaw } from './schema'

/**
 * Server actions for the encrypted integration-settings store (Spec A, Task 3.1).
 *
 * Integration secrets live under Settings, so every mutating action asserts
 * `requirePermission('settings', 'edit')` first (authentication + the
 * `settings.edit` capability). All DB access goes through the server-only
 * service-role client (`integration_settings` RLS is deny-all), so these actions
 * are the effective authorization boundary.
 *
 * SECURITY: a plaintext secret is only ever ENCRYPTED here (`setSecret`) — it is
 * never read back out to the client. The Test actions resolve secrets via
 * `getSecret` on the server, make a minimal authenticated provider call, and
 * return ok/{error} with NO secret material in the error string.
 */

const INTEGRATIONS_PATH = '/admin/settings/integrations'

/** Discriminated result returned by mutating actions. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

/**
 * Encrypt and store (upsert) a provider secret, overriding the env fallback.
 * Validates the key is one of the five managed keys and the value is non-empty,
 * encrypts with AES-256-GCM, and upserts on the `key` primary key, stamping
 * `updated_by` with the acting user's id.
 */
export async function setSecret(
  key: SecretKey,
  value: string
): Promise<ActionResult<void>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const parsed = secretInputSchema.safeParse({ key, value } satisfies SecretInputRaw)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const value_enc = encryptSecret(parsed.data.value)

  const supabase = getServiceClient()
  const { error } = await supabase
    .from('integration_settings')
    .upsert(
      {
        key: parsed.data.key,
        value_enc,
        updated_at: new Date().toISOString(),
        updated_by: gate.ctx.user.id,
      },
      { onConflict: 'key' }
    )

  if (error) {
    return { ok: false, error: `Failed to save secret: ${error.message}` }
  }

  revalidatePath(INTEGRATIONS_PATH)
  return { ok: true, data: undefined }
}

/**
 * Remove a provider secret's DB override, reverting to the env fallback (if any).
 * A delete of a non-existent row is a no-op success (the desired end state — no
 * override — already holds).
 */
export async function clearSecret(key: SecretKey): Promise<ActionResult<void>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const parsedKey = secretInputSchema.shape.key.safeParse(key)
  if (!parsedKey.success) {
    return { ok: false, error: 'Unknown secret key.' }
  }

  const supabase = getServiceClient()
  const { error } = await supabase
    .from('integration_settings')
    .delete()
    .eq('key', parsedKey.data)

  if (error) {
    return { ok: false, error: `Failed to clear secret: ${error.message}` }
  }

  revalidatePath(INTEGRATIONS_PATH)
  return { ok: true, data: undefined }
}

/**
 * Test the Razorpay credentials by making a minimal authenticated GET to the
 * Razorpay API (list one payment). Uses HTTP Basic auth with the resolved
 * `RAZORPAY_KEY_ID` : `RAZORPAY_KEY_SECRET`. A 2xx confirms the credentials
 * authenticate; a 401 means they are wrong. The secret is never included in the
 * returned error.
 */
export async function testRazorpay(): Promise<ActionResult<void>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const keyId = await getSecret('RAZORPAY_KEY_ID')
  const keySecret = await getSecret('RAZORPAY_KEY_SECRET')
  if (!keyId || !keySecret) {
    return { ok: false, error: 'Razorpay credentials are not configured.' }
  }

  try {
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64')
    const res = await fetch('https://api.razorpay.com/v1/payments?count=1', {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}` },
    })

    if (res.ok) {
      return { ok: true, data: undefined }
    }
    if (res.status === 401) {
      return { ok: false, error: 'Razorpay rejected the credentials (401 Unauthorized).' }
    }
    return { ok: false, error: `Razorpay test failed (HTTP ${res.status}).` }
  } catch (err) {
    // Never surface the secret — only a generic network/error message.
    const message = err instanceof Error ? err.message : 'unknown error'
    return { ok: false, error: `Could not reach Razorpay: ${message}` }
  }
}

/**
 * Test the AiSensy configuration. AiSensy exposes no dedicated credential-
 * validation endpoint (the campaign API requires a real destination + approved
 * template), so this performs a dry check that the API key resolves via the
 * secret store (DB override or env). A live send is verified out-of-band per the
 * ENV-PENDING note in `aisensy/send.ts`. No secret is included in the result.
 */
export async function testAiSensy(): Promise<ActionResult<void>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const apiKey = await getSecret('AISENSY_API_KEY')
  if (!apiKey) {
    return { ok: false, error: 'AiSensy API key is not configured.' }
  }

  return { ok: true, data: undefined }
}
