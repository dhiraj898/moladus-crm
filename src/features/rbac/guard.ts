import 'server-only'
import { redirect } from 'next/navigation'
import { getCurrentUserWithRole, type CurrentUserWithRole } from './permissions'
import { can, firstAllowedModule, modulePath } from './can'
import type { ModuleKey } from '@/lib/supabase/types'

/**
 * Gate an admin section by `view` (spec §7). Runs in a Node-runtime layout, so
 * it can use the service-role resolver (edge middleware cannot). Redirects an
 * unauthenticated user to login, and a user lacking `view` to their first
 * allowed module (or /admin/no-access when the role grants nothing). Returns the
 * resolved ctx so the page can read scope.
 */
export async function requireModuleView(
  module: ModuleKey
): Promise<CurrentUserWithRole> {
  const ctx = await getCurrentUserWithRole()
  if (!ctx) redirect('/admin/login')
  if (!can(ctx.permissions, module, 'view')) {
    const first = firstAllowedModule(ctx.permissions)
    redirect(first ? modulePath(first) : '/admin/no-access')
  }
  return ctx
}
