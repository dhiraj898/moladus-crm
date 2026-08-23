'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { getServiceClient } from '@/lib/supabase/server'
import { requirePermission } from '@/features/rbac/permissions'
import { encryptSecret } from '@/features/integrations/crypto'
import { endpointSchema, type EndpointInputRaw } from './schema'
import type { WebhookEvent } from './events'

/**
 * Server actions for outbound webhook endpoints (Spec B, plan WS4 Task 3).
 *
 * Webhooks live under Settings, so every mutating action first asserts
 * `requirePermission('settings', 'edit')` (authentication + the `settings.edit`
 * capability). All DB access goes through the server-only service-role client
 * (`webhook_endpoints` RLS is deny-all), so these actions are the effective
 * authorization boundary.
 *
 * SECURITY: the per-endpoint signing secret is generated server-side, encrypted
 * at rest via `encryptSecret` (Spec A AES-256-GCM), and its plaintext is
 * returned to the caller EXACTLY ONCE — at create and at rotate. It is never
 * read back afterwards (`listEndpoints` omits `secret_enc`), mirroring how an
 * API key is shown once and then only stored hashed/encrypted.
 */

const WEBHOOKS_PATH = '/admin/settings/webhooks'

/** Discriminated result returned by mutating actions. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

/** Generate a fresh 24-byte (48 hex char) signing secret. */
function generateSecret(): string {
  return randomBytes(24).toString('hex')
}

/**
 * Register a new endpoint. Validates the URL + at least one event, generates a
 * signing secret, encrypts it, and inserts the row stamped with the acting
 * user's id. Returns the new endpoint id and the plaintext secret — the only
 * time the secret is ever exposed.
 */
export async function createEndpoint(
  input: EndpointInputRaw
): Promise<ActionResult<{ id: string; secret: string }>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const parsed = endpointSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const secret = generateSecret()
  const secret_enc = encryptSecret(secret)

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('webhook_endpoints')
    .insert({
      url: parsed.data.url,
      events: parsed.data.events,
      secret_enc,
      active: true,
      created_by: gate.ctx.user.id,
    })
    .select('id')
    .single()

  if (error || !data) {
    return {
      ok: false,
      error: `Failed to create endpoint: ${error?.message ?? 'unknown error'}`,
    }
  }

  revalidatePath(WEBHOOKS_PATH)
  return { ok: true, data: { id: (data as { id: string }).id, secret } }
}

/**
 * Update an endpoint's subscribed events and/or active flag. `events`, when
 * provided, is re-validated (URL is immutable here — delete + recreate to change
 * it, which also rotates the secret). Never touches `secret_enc`.
 */
export async function updateEndpoint(
  id: string,
  patch: { events?: WebhookEvent[]; active?: boolean }
): Promise<ActionResult<void>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (patch.events !== undefined) {
    const parsed = endpointSchema.shape.events.safeParse(patch.events)
    if (!parsed.success) {
      return {
        ok: false,
        error: 'Select at least one valid event.',
        fieldErrors: { events: parsed.error.flatten().formErrors },
      }
    }
    update.events = parsed.data
  }
  if (patch.active !== undefined) {
    update.active = patch.active
  }

  const supabase = getServiceClient()
  const { error } = await supabase
    .from('webhook_endpoints')
    .update(update)
    .eq('id', id)

  if (error) {
    return { ok: false, error: `Failed to update endpoint: ${error.message}` }
  }

  revalidatePath(WEBHOOKS_PATH)
  return { ok: true, data: undefined }
}

/**
 * Permanently delete an endpoint (its deliveries cascade via the FK). Deleting a
 * non-existent row is a no-op success — the desired end state already holds.
 */
export async function deleteEndpoint(id: string): Promise<ActionResult<void>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const supabase = getServiceClient()
  const { error } = await supabase
    .from('webhook_endpoints')
    .delete()
    .eq('id', id)

  if (error) {
    return { ok: false, error: `Failed to delete endpoint: ${error.message}` }
  }

  revalidatePath(WEBHOOKS_PATH)
  return { ok: true, data: undefined }
}

/**
 * Rotate an endpoint's signing secret: generate a fresh secret, re-encrypt, and
 * store it. Returns the new plaintext once (like create). After rotation the old
 * secret stops verifying, so the receiver must be updated with the new value.
 */
export async function rotateSecret(
  id: string
): Promise<ActionResult<{ secret: string }>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const secret = generateSecret()
  const secret_enc = encryptSecret(secret)

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('webhook_endpoints')
    .update({ secret_enc, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
    .single()

  if (error || !data) {
    return {
      ok: false,
      error: `Failed to rotate secret: ${error?.message ?? 'endpoint not found'}`,
    }
  }

  revalidatePath(WEBHOOKS_PATH)
  return { ok: true, data: { secret } }
}
