import { getCurrentUserWithRole } from '@/features/rbac/permissions'
import { can, MODULE_ORDER } from '@/features/rbac/can'
import type { ModuleKey } from '@/lib/supabase/types'
import AdminNav from './AdminNav'
import SignOutButton from './SignOutButton'

/**
 * Admin shell (plan Task 6.2). Resolves the current session together with its
 * role/permissions via the service-role resolver (`getCurrentUserWithRole`),
 * then hands `AdminNav` a per-module `view` map so the sidebar only lists
 * sections the role can actually open. The middleware only lets unauthenticated
 * requests reach `/admin/login`, so a null ctx means the login page — render it
 * without the admin shell.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const ctx = await getCurrentUserWithRole()

  if (!ctx) {
    return <>{children}</>
  }

  const { user, permissions } = ctx
  const allowed = MODULE_ORDER.reduce(
    (acc, module) => {
      acc[module] = can(permissions, module, 'view')
      return acc
    },
    {} as Record<ModuleKey, boolean>
  )

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-[240px] flex-shrink-0 flex-col justify-between border-r border-line bg-bg px-4 py-6">
        <div>
          <div className="px-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
              Moladus
            </p>
            <p className="mt-1 text-sm font-semibold text-text">Admin</p>
          </div>
          <div className="mt-6">
            <AdminNav allowed={allowed} />
          </div>
        </div>

        <div className="flex flex-col gap-3 px-1">
          <p className="truncate px-2 text-xs text-faint" title={user.email ?? ''}>
            {user.email}
          </p>
          <SignOutButton />
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-8 py-8">{children}</main>
    </div>
  )
}
