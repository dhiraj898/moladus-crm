import { listCustomFieldDefs } from '@/features/crm/custom-fields/queries'
import { CUSTOM_FIELD_ENTITIES } from '@/features/crm/custom-fields/schema'
import { requireModuleView } from '@/features/rbac/guard'
import type { CustomFieldDef, CustomFieldEntity } from '@/lib/supabase/types'
import CustomFieldsEditor from './CustomFieldsEditor'

/**
 * Custom Fields editor page (spec §8). Server component: loads every entity's
 * definitions (active + inactive) via the service-role client in one pass and
 * hands the grouped map to the client editor for per-entity CRUD. Re-asserts
 * `settings.view` because the Settings shell also admits automation-only users
 * (see SettingsLayout), keeping this settings-only screen gated.
 */
export const dynamic = 'force-dynamic'

export default async function CustomFieldsSettingsPage() {
  await requireModuleView('settings')

  const lists = await Promise.all(
    CUSTOM_FIELD_ENTITIES.map((entity) => listCustomFieldDefs(entity))
  )
  const defsByEntity = Object.fromEntries(
    CUSTOM_FIELD_ENTITIES.map((entity, i) => [entity, lists[i]])
  ) as Record<CustomFieldEntity, CustomFieldDef[]>

  return <CustomFieldsEditor defsByEntity={defsByEntity} />
}
