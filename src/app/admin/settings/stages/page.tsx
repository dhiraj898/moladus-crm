import { listStages } from '@/features/crm/stages/queries'
import StagesEditor from './StagesEditor'

/**
 * Stages editor page (spec §6). Server component: reads the pipeline via the
 * service-role client and hands it to the client editor for CRUD.
 */
export const dynamic = 'force-dynamic'

export default async function StagesSettingsPage() {
  const stages = await listStages()
  return <StagesEditor stages={stages} />
}
