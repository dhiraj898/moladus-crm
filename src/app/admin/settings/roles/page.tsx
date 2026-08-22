import { listRoles } from '@/features/rbac/queries'
import { requireModuleView } from '@/features/rbac/guard'
import RolesEditor from './RolesEditor'

/**
 * Roles admin page (spec §10.1 / plan Task 6.3). Server component: reads every
 * role through the service-role client and hands them to the client editor for
 * the permission-matrix CRUD. Re-asserts `settings.view` here (the section
 * shell also admits automation-only users — see SettingsLayout); the mutating
 * actions re-assert `settings.edit`.
 */
export const dynamic = 'force-dynamic'

export default async function RolesSettingsPage() {
  await requireModuleView('settings')
  const roles = await listRoles()
  return <RolesEditor roles={roles} />
}
