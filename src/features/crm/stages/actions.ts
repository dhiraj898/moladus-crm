'use server'

import { revalidatePath } from 'next/cache'
import { getServiceClient } from '@/lib/supabase/server'
import { requirePermission } from '@/features/rbac/permissions'
import type { Stage } from '@/lib/supabase/types'
import { stageSchema, type StageInputRaw } from './schema'

/**
 * Server actions for the deal-stage pipeline config (spec §4.1 / §5 — Stages).
 *
 * Stage configuration lives under Settings, so every mutating action asserts
 * `requirePermission('settings', 'edit')` first (which internally calls
 * `getCurrentUser()` — authentication — then checks the `settings.edit`
 * capability — authorization). All DB access goes through the server-only
 * service-role client (RLS is deny-all), so these actions are the effective
 * authorization boundary. Each write revalidates the Stages editor path.
 */

const STAGES_PATH = '/admin/settings/stages'

/** Discriminated result returned by mutating actions. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

/**
 * Validate and insert a new stage. The new stage is appended to the end of the
 * pipeline (`display_order` = current max + 1) and is never the default.
 */
export async function createStage(
  input: StageInputRaw
): Promise<ActionResult<Stage>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const parsed = stageSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const supabase = getServiceClient()

  // Next display_order = current max + 1 (1-based; first stage is 1).
  const { data: last, error: maxError } = await supabase
    .from('stages')
    .select('display_order')
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (maxError) {
    return { ok: false, error: `Failed to create stage: ${maxError.message}` }
  }

  const nextOrder = (last?.display_order ?? 0) + 1

  const { data, error } = await supabase
    .from('stages')
    .insert({
      name: parsed.data.name,
      type: parsed.data.type,
      display_order: nextOrder,
      is_default: false,
    })
    .select('*')
    .single()

  if (error) {
    return { ok: false, error: `Failed to create stage: ${error.message}` }
  }

  revalidatePath(STAGES_PATH)
  return { ok: true, data: data as Stage }
}

/** Validate and update an existing stage's name + type; bumps `updated_at`. */
export async function updateStage(
  id: string,
  input: StageInputRaw
): Promise<ActionResult<Stage>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const parsed = stageSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('stages')
    .update({
      name: parsed.data.name,
      type: parsed.data.type,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    return { ok: false, error: `Failed to update stage: ${error.message}` }
  }

  revalidatePath(STAGES_PATH)
  return { ok: true, data: data as Stage }
}

/**
 * Persist a new pipeline order. Each id's position in `orderedIds` becomes its
 * `display_order` (1-based). Applied sequentially; a failure aborts and reports
 * the first error (partial reorder is additive and self-correcting on retry).
 */
export async function reorderStages(
  orderedIds: string[]
): Promise<ActionResult<void>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const supabase = getServiceClient()
  const now = new Date().toISOString()

  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from('stages')
      .update({ display_order: i + 1, updated_at: now })
      .eq('id', orderedIds[i])

    if (error) {
      return { ok: false, error: `Failed to reorder stages: ${error.message}` }
    }
  }

  revalidatePath(STAGES_PATH)
  return { ok: true, data: undefined }
}

/**
 * Make `id` the default stage for new deals. Clears the existing default first
 * so the `stages_one_default` partial unique index is never violated, then sets
 * the target. Sequential (clear → set) keeps the invariant of exactly one
 * default at rest.
 */
export async function setDefaultStage(id: string): Promise<ActionResult<void>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const supabase = getServiceClient()

  // Validate the target exists BEFORE clearing the current default. Otherwise a
  // stale/deleted id would clear the default, match 0 rows on the set, and leave
  // the pipeline with zero defaults — silently breaking new-deal creation.
  const { data: target, error: targetError } = await supabase
    .from('stages')
    .select('id')
    .eq('id', id)
    .maybeSingle()

  if (targetError) {
    return {
      ok: false,
      error: `Failed to set default stage: ${targetError.message}`,
    }
  }
  if (!target) {
    return { ok: false, error: 'Stage not found.' }
  }

  const { error: clearError } = await supabase
    .from('stages')
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq('is_default', true)

  if (clearError) {
    return {
      ok: false,
      error: `Failed to set default stage: ${clearError.message}`,
    }
  }

  const { error: setError } = await supabase
    .from('stages')
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (setError) {
    return {
      ok: false,
      error: `Failed to set default stage: ${setError.message}`,
    }
  }

  revalidatePath(STAGES_PATH)
  return { ok: true, data: undefined }
}

/**
 * Delete a stage. Refused when the stage is the default (a new default must be
 * chosen first) or when any deal still references it (which would orphan those
 * deals). Otherwise the row is deleted.
 */
export async function deleteStage(id: string): Promise<ActionResult<void>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const supabase = getServiceClient()

  // Guard 1: the default stage cannot be deleted.
  const { data: stage, error: loadError } = await supabase
    .from('stages')
    .select('is_default')
    .eq('id', id)
    .maybeSingle()

  if (loadError) {
    return { ok: false, error: `Failed to delete stage: ${loadError.message}` }
  }
  if (!stage) {
    return { ok: false, error: 'Stage not found.' }
  }
  if ((stage as { is_default: boolean }).is_default) {
    return { ok: false, error: 'Cannot delete the default stage.' }
  }

  // Guard 2: the stage cannot be in use by any deal.
  const { count, error: usageError } = await supabase
    .from('deals')
    .select('id', { count: 'exact', head: true })
    .eq('stage_id', id)

  if (usageError) {
    return { ok: false, error: `Failed to delete stage: ${usageError.message}` }
  }
  if ((count ?? 0) > 0) {
    return { ok: false, error: 'Stage is in use by deals.' }
  }

  const { error: deleteError } = await supabase
    .from('stages')
    .delete()
    .eq('id', id)

  if (deleteError) {
    return { ok: false, error: `Failed to delete stage: ${deleteError.message}` }
  }

  revalidatePath(STAGES_PATH)
  return { ok: true, data: undefined }
}
