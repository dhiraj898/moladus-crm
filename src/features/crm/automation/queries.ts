import 'server-only'
import { getServiceClient } from '@/lib/supabase/server'
import type { EntryRule, StageAction, SlaRule } from '@/lib/supabase/types'

/**
 * Server-only reads for workflow-automation config (design §4).
 *
 * Like the Stages queries, this module is `server-only` so it is never exposed
 * as a client-invocable Server Action. The engine (`entry.ts`, `sla.ts`) and
 * server components import these helpers directly. All access goes through the
 * service-role client (RLS is deny-all on every automation table).
 */

/**
 * Active entry rules ordered by ascending `priority` (lower = evaluated first).
 * The resolver walks this list and takes the first whose condition matches.
 */
export async function listActiveEntryRules(): Promise<EntryRule[]> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('entry_rules')
    .select('*')
    .eq('active', true)
    .order('priority', { ascending: true })

  if (error) throw new Error(`Failed to list entry rules: ${error.message}`)
  return (data ?? []) as EntryRule[]
}

/**
 * Every entry rule (active and inactive) ordered by ascending `priority`, for
 * the config editor. The NULL-condition fallback (highest priority number)
 * sorts to the bottom.
 */
export async function listEntryRules(): Promise<EntryRule[]> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('entry_rules')
    .select('*')
    .order('priority', { ascending: true })

  if (error) throw new Error(`Failed to list entry rules: ${error.message}`)
  return (data ?? []) as EntryRule[]
}

/**
 * On-enter actions for one stage, ordered by ascending `run_order`. Used by the
 * config editor and the runner (`runActions.ts` filters to active).
 */
export async function listStageActions(stageId: string): Promise<StageAction[]> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('stage_actions')
    .select('*')
    .eq('stage_id', stageId)
    .order('run_order', { ascending: true })

  if (error) throw new Error(`Failed to list stage actions: ${error.message}`)
  return (data ?? []) as StageAction[]
}

/**
 * Every on-enter action across all stages, ordered by stage then `run_order`.
 * The config page groups these by `stage_id` for per-stage rendering.
 */
export async function listAllStageActions(): Promise<StageAction[]> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('stage_actions')
    .select('*')
    .order('stage_id', { ascending: true })
    .order('run_order', { ascending: true })

  if (error) throw new Error(`Failed to list stage actions: ${error.message}`)
  return (data ?? []) as StageAction[]
}

/** Every SLA rule (active and inactive), oldest first, for the config editor. */
export async function listSlaRules(): Promise<SlaRule[]> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('sla_rules')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to list SLA rules: ${error.message}`)
  return (data ?? []) as SlaRule[]
}
