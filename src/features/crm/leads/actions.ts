'use server'

import { revalidatePath } from 'next/cache'
import { getServiceClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/auth'
import { logActivity } from '@/features/crm/activities/service'
import { leadSchema, type LeadInputRaw } from './schema'

/**
 * Server actions for leads (spec §6 — Lead detail + manual create/edit).
 *
 * All DB access goes through the server-only service-role client (RLS is
 * deny-all). Every mutating action asserts an admin session via
 * `getCurrentUser()` first and stamps the returned `user.id` as the lead's
 * `owner_id` (create) and as the actor on the activity timeline — that
 * per-action check is the effective authorization boundary (see
 * `src/lib/supabase/auth.ts`).
 */

/** Discriminated result returned by mutating actions. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

/** Error returned when a mutation is attempted without an admin session. */
const UNAUTHENTICATED = 'You must be signed in to do that.'

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Manually create a lead. Validates the input, inserts a thin record owned by
 * the current user (an empty `raw_payload` since there is no form submission),
 * logs a `created` activity, and returns the new id.
 */
export async function createLead(
  input: LeadInputRaw
): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: UNAUTHENTICATED }

  const parsed = leadSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }
  const { name, email, phone, state, source, status, product_id } = parsed.data

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('leads')
    .insert({
      name: name ?? null,
      email: email ?? null,
      phone: phone ?? null,
      state: state ?? null,
      source: source ?? null,
      status,
      product_id: product_id ?? null,
      owner_id: user.id,
      raw_payload: {},
    })
    .select('id')
    .single()

  if (error || !data) {
    return {
      ok: false,
      error: `Failed to create lead: ${error?.message ?? 'unknown error'}`,
    }
  }
  const id = (data as { id: string }).id

  await logActivity('lead', id, 'created', { actorId: user.id })

  revalidatePath('/admin/leads')
  revalidatePath(`/admin/leads/${id}`)
  return { ok: true, data: { id } }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Update an existing lead's editable fields. Validates the input, writes the
 * changes, logs an `edited` activity, and revalidates the detail + list pages.
 */
export async function updateLead(
  id: string,
  input: LeadInputRaw
): Promise<ActionResult<void>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: UNAUTHENTICATED }

  const parsed = leadSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }
  const { name, email, phone, state, source, status, product_id } = parsed.data

  const supabase = getServiceClient()
  const { error } = await supabase
    .from('leads')
    .update({
      name: name ?? null,
      email: email ?? null,
      phone: phone ?? null,
      state: state ?? null,
      source: source ?? null,
      status,
      product_id: product_id ?? null,
    })
    .eq('id', id)

  if (error) {
    return { ok: false, error: `Failed to update lead: ${error.message}` }
  }

  await logActivity('lead', id, 'edited', { actorId: user.id })

  revalidatePath('/admin/leads')
  revalidatePath(`/admin/leads/${id}`)
  return { ok: true, data: undefined }
}
