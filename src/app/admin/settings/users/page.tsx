import { listAssignableUsers, listRoles } from '@/features/rbac/queries'
import { requireModuleView } from '@/features/rbac/guard'
import UsersEditor from './UsersEditor'

/**
 * Users admin page (spec §10.2 / plan Task 6.3). Server component: loads every
 * admin user (with their current role) and the full role list through the
 * service-role client, then hands them to the client editor for role
 * assignment. Re-asserts `settings.view` here (the section shell also admits
 * automation-only users — see SettingsLayout); the `assignUserRole` action
 * re-asserts `settings.edit`.
 */
export const dynamic = 'force-dynamic'

export default async function UsersSettingsPage() {
  await requireModuleView('settings')
  const [users, roles] = await Promise.all([listAssignableUsers(), listRoles()])
  return <UsersEditor users={users} roles={roles} />
}
