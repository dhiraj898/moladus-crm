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

/**
 * Gate a section shell that hosts several modules by `view` on ANY of them
 * (spec §7). Used by the Settings layout, which nests both `settings` (Stages /
 * Roles / Users) and `automation` pages: a user with only `automation.view`
 * must be allowed into the subtree so AutomationLayout's own gate can admit
 * them, otherwise gating the shell solely on `settings` funnels an
 * automation-only user into an infinite redirect loop (firstAllowedModule
 * resolves back to /admin/settings/automation, re-entering this shell). The
 * individual settings-only pages still assert `settings.view` themselves.
 * Redirects an unauthenticated user to login, and a user who can view none of
 * `modules` to their first allowed module (or /admin/no-access).
 */
export async function requireAnyModuleView(
  modules: ModuleKey[]
): Promise<CurrentUserWithRole> {
  const ctx = await getCurrentUserWithRole()
  if (!ctx) redirect('/admin/login')
  if (!modules.some((m) => can(ctx.permissions, m, 'view'))) {
    const first = firstAllowedModule(ctx.permissions)
    redirect(first ? modulePath(first) : '/admin/no-access')
  }
  return ctx
}
