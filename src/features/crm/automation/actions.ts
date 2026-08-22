'use server'

import { revalidatePath } from 'next/cache'
import { getServiceClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/auth'
import type { EntryRule, StageAction, SlaRule } from '@/lib/supabase/types'
import {
  entryRuleSchema,
  stageActionSchema,
  slaRuleSchema,
  type EntryRuleInputRaw,
  type StageActionInputRaw,
  type SlaRuleInputRaw,
} from './schema'

/**
 * Auth-gated CRUD server actions for workflow-automation config (design §7).
 *
 * RLS is deny-all on every automation table, so the service-role client is the
 * only DB path and these actions are the effective authorization boundary: each
 * mutating action asserts an admin session via `getCurrentUser()` before it
 * touches the DB (see `src/lib/supabase/auth.ts`). Every write revalidates the
 * Automation settings page. Mirrors the Stages actions module.
 */

const AUTOMATION_PATH = '/admin/settings/automation'

/** Discriminated result returned by mutating actions (mirrors Stages). */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

/** Error returned when a mutation is attempted without an admin session. */
const UNAUTHENTICATED = 'You must be signed in to do that.'

const VALIDATION_ERROR = 'Please correct the highlighted fields.'

// ---------------------------------------------------------------------------
// Entry rules
// ---------------------------------------------------------------------------

/**
 * Insert a new entry rule. Unless a `priority` is supplied it is placed so that
 * first-match-by-ascending-priority still does the right thing: a new *fallback*
 * (NULL condition) is appended below everything (current max + 1), while a new
 * *conditional* rule is inserted just above the fallback(s) — above the highest
 * conditional rule, with any fallback that would sort at or above it pushed down.
 * Without this, a fresh conditional rule would land below the always-matching
 * fallback and never fire.
 */
export async function createEntryRule(
  input: EntryRuleInputRaw
): Promise<ActionResult<EntryRule>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: UNAUTHENTICATED }

  const parsed = entryRuleSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: VALIDATION_ERROR,
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const supabase = getServiceClient()

  let priority = parsed.data.priority
  if (priority === undefined) {
    const { data: existing, error: listError } = await supabase
      .from('entry_rules')
      .select('id, priority, condition')
    if (listError) {
      return {
        ok: false,
        error: `Failed to create entry rule: ${listError.message}`,
      }
    }

    const rows = (existing ?? []) as Pick<
      EntryRule,
      'id' | 'priority' | 'condition'
    >[]

    if (parsed.data.condition === null) {
      // A new fallback: sits below every existing rule.
      priority = rows.reduce((max, r) => Math.max(max, r.priority), 0) + 1
    } else {
      // A new conditional rule: above the highest conditional rule, and above
      // every fallback so the always-matching catch-all keeps evaluating last.
      const conditional = rows.filter((r) => r.condition !== null)
      const fallbacks = rows.filter((r) => r.condition === null)
      const newPriority =
        conditional.reduce((max, r) => Math.max(max, r.priority), 0) + 1
      priority = newPriority

      // Push any fallback sitting at or above the new rule below it, keeping
      // their relative order stable.
      let next = newPriority + 1
      const toBump = fallbacks
        .filter((fb) => fb.priority <= newPriority)
        .sort((a, b) => a.priority - b.priority)
      const now = new Date().toISOString()
      for (const fb of toBump) {
        const { error: bumpError } = await supabase
          .from('entry_rules')
          .update({ priority: next, updated_at: now })
          .eq('id', fb.id)
        if (bumpError) {
          return {
            ok: false,
            error: `Failed to create entry rule: ${bumpError.message}`,
          }
        }
        next++
      }
    }
  }

  const { data, error } = await supabase
    .from('entry_rules')
    .insert({
      condition: parsed.data.condition,
      to_stage_id: parsed.data.to_stage_id,
      priority,
      active: parsed.data.active ?? true,
    })
    .select('*')
    .single()

  if (error) {
    return { ok: false, error: `Failed to create entry rule: ${error.message}` }
  }

  revalidatePath(AUTOMATION_PATH)
  return { ok: true, data: data as EntryRule }
}

/** Update an entry rule's condition / target stage / active flag. */
export async function updateEntryRule(
  id: string,
  input: EntryRuleInputRaw
): Promise<ActionResult<EntryRule>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: UNAUTHENTICATED }

  const parsed = entryRuleSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: VALIDATION_ERROR,
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const supabase = getServiceClient()
  const patch: Record<string, unknown> = {
    condition: parsed.data.condition,
    to_stage_id: parsed.data.to_stage_id,
    updated_at: new Date().toISOString(),
  }
  if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority
  if (parsed.data.active !== undefined) patch.active = parsed.data.active

  const { data, error } = await supabase
    .from('entry_rules')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    return { ok: false, error: `Failed to update entry rule: ${error.message}` }
  }

  revalidatePath(AUTOMATION_PATH)
  return { ok: true, data: data as EntryRule }
}

/**
 * Persist a new evaluation order. Each id's position in `orderedIds` becomes
 * its `priority` (1-based). Applied sequentially; a failure aborts and reports
 * the first error (a partial reorder is self-correcting on retry).
 */
export async function reorderEntryRules(
  orderedIds: string[]
): Promise<ActionResult<void>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: UNAUTHENTICATED }

  const supabase = getServiceClient()
  const now = new Date().toISOString()

  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from('entry_rules')
      .update({ priority: i + 1, updated_at: now })
      .eq('id', orderedIds[i])
    if (error) {
      return {
        ok: false,
        error: `Failed to reorder entry rules: ${error.message}`,
      }
    }
  }

  revalidatePath(AUTOMATION_PATH)
  return { ok: true, data: undefined }
}

/** Delete an entry rule. */
export async function deleteEntryRule(id: string): Promise<ActionResult<void>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: UNAUTHENTICATED }

  const supabase = getServiceClient()
  const { error } = await supabase.from('entry_rules').delete().eq('id', id)
  if (error) {
    return { ok: false, error: `Failed to delete entry rule: ${error.message}` }
  }

  revalidatePath(AUTOMATION_PATH)
  return { ok: true, data: undefined }
}

// ---------------------------------------------------------------------------
// Stage on-enter actions
// ---------------------------------------------------------------------------

/**
 * Insert a new on-enter action for a stage. Unless a `run_order` is supplied it
 * is appended after the stage's existing actions (max + 1). `action_type` can
 * never be `move_stage` — the Zod schema excludes it (loop guard).
 */
export async function createStageAction(
  input: StageActionInputRaw
): Promise<ActionResult<StageAction>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: UNAUTHENTICATED }

  const parsed = stageActionSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: VALIDATION_ERROR,
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const supabase = getServiceClient()

  let runOrder = parsed.data.run_order
  if (runOrder === undefined) {
    const { data: last, error: maxError } = await supabase
      .from('stage_actions')
      .select('run_order')
      .eq('stage_id', parsed.data.stage_id)
      .order('run_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (maxError) {
      return {
        ok: false,
        error: `Failed to create stage action: ${maxError.message}`,
      }
    }
    runOrder = (last?.run_order ?? 0) + 1
  }

  const { data, error } = await supabase
    .from('stage_actions')
    .insert({
      stage_id: parsed.data.stage_id,
      action_type: parsed.data.action_type,
      config: parsed.data.config,
      run_order: runOrder,
      active: parsed.data.active ?? true,
    })
    .select('*')
    .single()

  if (error) {
    return {
      ok: false,
      error: `Failed to create stage action: ${error.message}`,
    }
  }

  revalidatePath(AUTOMATION_PATH)
  return { ok: true, data: data as StageAction }
}

/** Update an on-enter action's type / config / active flag. */
export async function updateStageAction(
  id: string,
  input: StageActionInputRaw
): Promise<ActionResult<StageAction>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: UNAUTHENTICATED }

  const parsed = stageActionSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: VALIDATION_ERROR,
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const supabase = getServiceClient()
  const patch: Record<string, unknown> = {
    stage_id: parsed.data.stage_id,
    action_type: parsed.data.action_type,
    config: parsed.data.config,
  }
  if (parsed.data.run_order !== undefined) patch.run_order = parsed.data.run_order
  if (parsed.data.active !== undefined) patch.active = parsed.data.active

  const { data, error } = await supabase
    .from('stage_actions')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    return {
      ok: false,
      error: `Failed to update stage action: ${error.message}`,
    }
  }

  revalidatePath(AUTOMATION_PATH)
  return { ok: true, data: data as StageAction }
}

/**
 * Persist a new run order for one stage's on-enter actions. Each id's position
 * in `orderedIds` becomes its `run_order` (1-based). Sequential; aborts on the
 * first error.
 */
export async function reorderStageActions(
  orderedIds: string[]
): Promise<ActionResult<void>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: UNAUTHENTICATED }

  const supabase = getServiceClient()

  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from('stage_actions')
      .update({ run_order: i + 1 })
      .eq('id', orderedIds[i])
    if (error) {
      return {
        ok: false,
        error: `Failed to reorder stage actions: ${error.message}`,
      }
    }
  }

  revalidatePath(AUTOMATION_PATH)
  return { ok: true, data: undefined }
}

/** Delete an on-enter action. */
export async function deleteStageAction(
  id: string
): Promise<ActionResult<void>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: UNAUTHENTICATED }

  const supabase = getServiceClient()
  const { error } = await supabase.from('stage_actions').delete().eq('id', id)
  if (error) {
    return {
      ok: false,
      error: `Failed to delete stage action: ${error.message}`,
    }
  }

  revalidatePath(AUTOMATION_PATH)
  return { ok: true, data: undefined }
}

// ---------------------------------------------------------------------------
// SLA rules
// ---------------------------------------------------------------------------

/**
 * A `move_stage` SLA rule targets `config.to_stage_id`, which the Zod schema
 * only shape-checks (it is jsonb with no FK). Confirm the stage actually exists
 * before persisting so a stale/invalid id can never be stored. Returns a
 * field-error result to surface, or null when the target is valid / not a
 * move_stage rule.
 */
async function verifyMoveStageTarget(
  supabase: ReturnType<typeof getServiceClient>,
  actionType: SlaRule['action_type'],
  config: Record<string, unknown>
): Promise<ActionResult<never> | null> {
  if (actionType !== 'move_stage') return null
  const toStageId = config.to_stage_id
  if (typeof toStageId === 'string') {
    const { data, error } = await supabase
      .from('stages')
      .select('id')
      .eq('id', toStageId)
      .maybeSingle()
    if (error) {
      return { ok: false, error: `Failed to verify target stage: ${error.message}` }
    }
    if (data) return null
  }
  return {
    ok: false,
    error: VALIDATION_ERROR,
    fieldErrors: { 'config.to_stage_id': ['That stage no longer exists.'] },
  }
}

/** Insert a new SLA rule. */
export async function createSlaRule(
  input: SlaRuleInputRaw
): Promise<ActionResult<SlaRule>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: UNAUTHENTICATED }

  const parsed = slaRuleSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: VALIDATION_ERROR,
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const supabase = getServiceClient()

  const targetError = await verifyMoveStageTarget(
    supabase,
    parsed.data.action_type,
    parsed.data.config
  )
  if (targetError) return targetError

  const { data, error } = await supabase
    .from('sla_rules')
    .insert({
      from_stage_id: parsed.data.from_stage_id,
      delay_minutes: parsed.data.delay_minutes,
      condition: parsed.data.condition,
      action_type: parsed.data.action_type,
      config: parsed.data.config,
      active: parsed.data.active ?? true,
    })
    .select('*')
    .single()

  if (error) {
    return { ok: false, error: `Failed to create SLA rule: ${error.message}` }
  }

  revalidatePath(AUTOMATION_PATH)
  return { ok: true, data: data as SlaRule }
}

/** Update an SLA rule. */
export async function updateSlaRule(
  id: string,
  input: SlaRuleInputRaw
): Promise<ActionResult<SlaRule>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: UNAUTHENTICATED }

  const parsed = slaRuleSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: VALIDATION_ERROR,
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const supabase = getServiceClient()

  const targetError = await verifyMoveStageTarget(
    supabase,
    parsed.data.action_type,
    parsed.data.config
  )
  if (targetError) return targetError

  const patch: Record<string, unknown> = {
    from_stage_id: parsed.data.from_stage_id,
    delay_minutes: parsed.data.delay_minutes,
    condition: parsed.data.condition,
    action_type: parsed.data.action_type,
    config: parsed.data.config,
  }
  if (parsed.data.active !== undefined) patch.active = parsed.data.active

  const { data, error } = await supabase
    .from('sla_rules')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    return { ok: false, error: `Failed to update SLA rule: ${error.message}` }
  }

  revalidatePath(AUTOMATION_PATH)
  return { ok: true, data: data as SlaRule }
}

/** Delete an SLA rule. */
export async function deleteSlaRule(id: string): Promise<ActionResult<void>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: UNAUTHENTICATED }

  const supabase = getServiceClient()
  const { error } = await supabase.from('sla_rules').delete().eq('id', id)
  if (error) {
    return { ok: false, error: `Failed to delete SLA rule: ${error.message}` }
  }

  revalidatePath(AUTOMATION_PATH)
  return { ok: true, data: undefined }
}

/** Flip an SLA rule's `active` flag. */
export async function toggleSlaRule(
  id: string,
  active: boolean
): Promise<ActionResult<SlaRule>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: UNAUTHENTICATED }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('sla_rules')
    .update({ active })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    return { ok: false, error: `Failed to update SLA rule: ${error.message}` }
  }

  revalidatePath(AUTOMATION_PATH)
  return { ok: true, data: data as SlaRule }
}
