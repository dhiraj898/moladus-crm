import { listStages } from '@/features/crm/stages/queries'
import {
  listEntryRules,
  listAllStageActions,
  listSlaRules,
} from '@/features/crm/automation/queries'
import type { StageAction } from '@/lib/supabase/types'
import EntryRulesEditor from './EntryRulesEditor'
import StageActionsEditor from './StageActionsEditor'
import SlaRulesEditor from './SlaRulesEditor'

/**
 * Automation settings page (design §7). Server component: reads the pipeline
 * and all automation config via the service-role client and hands each slice to
 * a client editor. Force-dynamic so edits reflect the authoritative DB state on
 * every refresh.
 */
export const dynamic = 'force-dynamic'

export default async function AutomationSettingsPage() {
  const [stages, entryRules, allStageActions, slaRules] = await Promise.all([
    listStages(),
    listEntryRules(),
    listAllStageActions(),
    listSlaRules(),
  ])

  // Group on-enter actions by stage for per-stage rendering.
  const actionsByStage = allStageActions.reduce<Record<string, StageAction[]>>(
    (acc, action) => {
      ;(acc[action.stage_id] ??= []).push(action)
      return acc
    },
    {}
  )

  return (
    <div className="flex flex-col gap-12">
      <EntryRulesEditor stages={stages} rules={entryRules} />
      <StageActionsEditor stages={stages} actionsByStage={actionsByStage} />
      <SlaRulesEditor stages={stages} rules={slaRules} />
    </div>
  )
}
