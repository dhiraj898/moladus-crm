import { listStages } from '@/features/crm/stages/queries'
import { requireModuleView } from '@/features/rbac/guard'
import StagesEditor from './StagesEditor'

/**
 * Stages editor page (spec §6). Server component: reads the pipeline via the
 * service-role client and hands it to the client editor for CRUD. Re-asserts
 * `settings.view` because the section shell also admits automation-only users
 * (see SettingsLayout), keeping this settings-only screen gated.
 */
export const dynamic = 'force-dynamic'

export default async function StagesSettingsPage() {
  await requireModuleView('settings')
  const stages = await listStages()
  return <StagesEditor stages={stages} />
}
