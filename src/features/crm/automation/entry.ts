import { getServiceClient } from '@/lib/supabase/server'
import { evaluateCondition } from './conditions'
import { listActiveEntryRules } from './queries'

/**
 * Entry-stage resolver (design §4.1, decision §3.2).
 *
 * On form submit, active entry rules are evaluated by ascending `priority`
 * (lower = first). The first rule whose condition matches the answers sets the
 * initial stage. The seeded default rule has a NULL condition (always matches)
 * at the lowest priority, so it acts as the catch-all. If, despite that, no
 * rule matches (e.g. the fallback rule was deleted or deactivated), we fall
 * back to the `stages.is_default` stage so a submission always lands somewhere.
 *
 * `getServiceClient`'s own module is `server-only`, so this resolver can only
 * run server-side (ingest route, `changeDealStage`).
 */
export async function resolveEntryStage(
  answers: Record<string, unknown>,
): Promise<string> {
  const rules = await listActiveEntryRules()

  for (const rule of rules) {
    if (evaluateCondition(rule.condition, answers)) {
      return rule.to_stage_id
    }
  }

  // No rule matched — fall back to the default pipeline stage.
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('stages')
    .select('id')
    .eq('is_default', true)
    .maybeSingle()

  if (error) throw new Error(`Failed to resolve default stage: ${error.message}`)
  if (!data) throw new Error('No default stage configured (stages.is_default)')

  return (data as { id: string }).id
}
