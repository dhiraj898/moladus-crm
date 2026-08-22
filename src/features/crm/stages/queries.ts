import 'server-only'
import { getServiceClient } from '@/lib/supabase/server'
import type { Stage } from '@/lib/supabase/types'

/**
 * Server-only reads for the deal-stage pipeline config (spec §4.1 / §5).
 *
 * This module is `server-only`, so it is never exposed as a client-invocable
 * Server Action endpoint (unlike the `'use server'` module in `actions.ts`).
 * Server components import these helpers directly.
 */

/** Fetch every stage, ordered by `display_order` ascending. */
export async function listStages(): Promise<Stage[]> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('stages')
    .select('*')
    .order('display_order', { ascending: true })

  if (error) throw new Error(`Failed to list stages: ${error.message}`)
  return (data ?? []) as Stage[]
}
