'use server'

import { revalidatePath } from 'next/cache'
import { getServiceClient } from '@/lib/supabase/server'
import { requirePermission } from '@/features/rbac/permissions'
import { scopeFor } from '@/features/rbac/can'
import { logActivity } from '@/features/crm/activities/service'
import { leadSchema, type LeadInputRaw } from './schema'

/**
 * Server actions for leads (spec §6 — Lead detail + manual create/edit).
 *
 * All DB access goes through the server-only service-role client (RLS is
 * deny-all). Every mutating action asserts `requirePermission('leads', 'edit')`
 * first (which internally calls `getCurrentUser()` — authentication — then
 * checks the `leads.edit` capability — authorization). For an own-scope role,
 * the update path additionally re-checks record ownership BEFORE mutating, so a
 * forged action id cannot write a lead the caller cannot see. `ctx.user.id` is
 * stamped as the lead's `owner_id` (create) and as the timeline actor.
 */

/** Discriminated result returned by mutating actions. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

/** Returned when an own-scope caller targets a lead they do not own. */
const NOT_FOUND = 'Not found'

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
  const gate = await requirePermission('leads', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }
  const { ctx } = gate

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
      // Manual create: the creator becomes the initial owner/assignee. Round-robin
      // auto-assignment applies ONLY to ingested submissions, never manual creates
      // (RBAC spec §9); reassignment afterwards is done via `assignLead`.
      owner_id: ctx.user.id,
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

  await logActivity('lead', id, 'created', { actorId: ctx.user.id })

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
  const gate = await requirePermission('leads', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }
  const { ctx } = gate

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

  // Own-scope IDOR guard: re-read the row's owner_id and refuse when it is not
  // the caller's — BEFORE mutating. This closes the gap where the read side
  // hides a lead but a forged action id could still write it.
  if (scopeFor(ctx.permissions, 'leads') === 'own') {
    const { data: row } = await supabase
      .from('leads')
      .select('owner_id')
      .eq('id', id)
      .maybeSingle()
    const owner = (row as { owner_id: string | null } | null)?.owner_id ?? null
    if (owner !== ctx.user.id) return { ok: false, error: NOT_FOUND }
  }

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

  await logActivity('lead', id, 'edited', { actorId: ctx.user.id })

  revalidatePath('/admin/leads')
  revalidatePath(`/admin/leads/${id}`)
  return { ok: true, data: undefined }
}
