import 'server-only'
import { getServiceClient } from '@/lib/supabase/server'
import type { EntryRule } from '@/lib/supabase/types'

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
