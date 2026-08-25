'use server'

import { revalidatePath } from 'next/cache'
import { getServiceClient } from '@/lib/supabase/server'
import { requirePermission } from '@/features/rbac/permissions'
import { scopeFor } from '@/features/rbac/can'
import { logActivity } from '@/features/crm/activities/service'
import { getActiveCustomFieldDefs } from '@/features/crm/custom-fields/queries'
import {
  validateCustomFields,
  toFieldErrors,
} from '@/features/crm/custom-fields/validate'
import {
  loadColumnRows,
  type LeadFilters,
  type LeadListItem,
} from '@/features/records/queries'
import { columnWindow } from '@/features/views/kanbanPaging'
import { leadSchema, LEAD_STATUSES, type LeadInputRaw } from './schema'

/** A valid lead workflow status (the stored `leads.status` value). */
export type LeadStatus = (typeof LEAD_STATUSES)[number]

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

  const defs = await getActiveCustomFieldDefs('lead')
  const cf = validateCustomFields('lead', defs, parsed.data.custom_fields ?? {})
  if (!cf.ok) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: toFieldErrors(cf.errors),
    }
  }

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
      custom_fields: cf.values,
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
// Status change (Kanban drag)
// ---------------------------------------------------------------------------

/**
 * Move a lead to a new workflow status. Mirrors `changeDealStage`
 * (`src/features/crm/deals/actions.ts`): asserts `leads.edit`, then — for an
 * own-scope role — re-reads `leads.owner_id` and refuses a lead the caller does
 * not own BEFORE mutating, so a forged action id cannot write a lead the caller
 * cannot see. The target `status` must be one of {@link LEAD_STATUSES}. Updates
 * `leads.status`, logs an `edited` activity carrying the new status, and
 * revalidates the leads list.
 */
export async function changeLeadStatus(
  leadId: string,
  status: LeadStatus
): Promise<ActionResult<void>> {
  const gate = await requirePermission('leads', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }
  const { ctx } = gate

  // Validate the target status against the canonical picklist.
  if (!LEAD_STATUSES.includes(status)) {
    return { ok: false, error: 'Invalid status.' }
  }

  const supabase = getServiceClient()

  // Own-scope IDOR guard: re-read the row's owner_id and refuse when it is not
  // the caller's — BEFORE mutating.
  if (scopeFor(ctx.permissions, 'leads') === 'own') {
    const { data: row } = await supabase
      .from('leads')
      .select('owner_id')
      .eq('id', leadId)
      .maybeSingle()
    const owner = (row as { owner_id: string | null } | null)?.owner_id ?? null
    if (owner !== ctx.user.id) return { ok: false, error: NOT_FOUND }
  }

  const { error } = await supabase
    .from('leads')
    .update({ status })
    .eq('id', leadId)

  if (error) {
    return { ok: false, error: `Failed to change status: ${error.message}` }
  }

  await logActivity('lead', leadId, 'edited', {
    actorId: ctx.user.id,
    metadata: { status },
  })

  revalidatePath('/admin/leads')
  return { ok: true, data: undefined }
}

// ---------------------------------------------------------------------------
// Kanban "Load more" (per-column paging) — plan Task 3.2
// ---------------------------------------------------------------------------

/**
 * Fetch the next window of leads for one Kanban column (a status), for the
 * board's "Load more" button. View-gated by `leads.view`; the RBAC own-vs-all
 * scope + every active filter are re-derived server-side inside
 * {@link loadColumnRows}, so the client cannot widen its scope through the
 * `columnId`/`offset` params. The offset is clamped to a safe window by
 * {@link columnWindow}. Returns the window's `rows` plus the column's fresh
 * `total`.
 */
export async function loadLeadColumnRows(input: {
  columnId: string
  offset: number
  filters?: LeadFilters
}): Promise<ActionResult<{ rows: LeadListItem[]; total: number }>> {
  const gate = await requirePermission('leads', 'view')
  if (!gate.ok) return { ok: false, error: gate.error }
  const { ctx } = gate

  const window = columnWindow(input.offset)
  const { rows, total } = await loadColumnRows({
    entity: 'leads',
    columnId: input.columnId,
    offset: window.offset,
    limit: window.limit,
    filters: input.filters ?? {},
    ctx,
  })
  return { ok: true, data: { rows, total } }
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

  const defs = await getActiveCustomFieldDefs('lead')
  const cf = validateCustomFields('lead', defs, parsed.data.custom_fields ?? {})
  if (!cf.ok) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: toFieldErrors(cf.errors),
    }
  }

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

  // Preserve values for inactive/deleted defs: load the existing row's
  // custom_fields, drop the keys owned by the active defs, then spread the
  // freshly-validated values on top so hidden values survive an edit.
  const { data: existing } = await supabase
    .from('leads')
    .select('custom_fields')
    .eq('id', id)
    .maybeSingle()
  const activeKeys = new Set(defs.map((d) => d.key))
  const preserved = Object.fromEntries(
    Object.entries(
      (existing?.custom_fields ?? {}) as Record<string, unknown>
    ).filter(([k]) => !activeKeys.has(k))
  )
  const mergedCustom = { ...preserved, ...cf.values }

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
      custom_fields: mergedCustom,
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
