import 'server-only'
import type { User } from '@supabase/supabase-js'
import { getCurrentUser } from '@/lib/supabase/auth'
import { getServiceClient } from '@/lib/supabase/server'
import { can, DEFAULT_DENY_ALL, normalizePermissions } from './can'
import type {
  Capability,
  ModuleKey,
  Permissions,
  Role,
} from '@/lib/supabase/types'

/**
 * Authorization resolver (spec §6.2). Loads the current session, its profile →
 * role, and normalized permissions. All DB access is via the service-role client
 * (RLS deny-all). Fails closed: a signed-in user with no profile/role resolves
 * to DEFAULT_DENY_ALL rather than throwing or granting anything.
 */

export interface CurrentUserWithRole {
  user: User
  role: Role | null
  permissions: Permissions
}

/** Error returned when a mutation is attempted without a session. */
const UNAUTHENTICATED = 'You must be signed in to do that.'
/** Error returned when the session lacks the required permission. */
const FORBIDDEN = 'You do not have permission to do that.'

export async function getCurrentUserWithRole(): Promise<CurrentUserWithRole | null> {
  const user = await getCurrentUser()
  if (!user) return null

  const supabase = getServiceClient()
  const selectProfile = () =>
    supabase
      .from('profiles')
      .select(
        'role_id, role:roles (id, name, permissions, in_assignment_pool, is_system, created_at, updated_at)'
      )
      .eq('user_id', user.id)
      .maybeSingle()

  // Retry ONCE on a transient lookup error before failing closed, so a momentary
  // DB hiccup doesn't spuriously lock a valid user out (they'd otherwise see the
  // no-access screen). A successful query with no row is a legitimate deny and is
  // NOT retried below.
  let { data, error } = await selectProfile()
  if (error) {
    ;({ data, error } = await selectProfile())
  }

  if (error) {
    // Fail closed on a persistent lookup error — deny rather than crash the render.
    return { user, role: null, permissions: structuredClone(DEFAULT_DENY_ALL) }
  }

  type Row = { role: Role | null } | null
  const roleRow = (data as unknown as Row)?.role ?? null
  if (!roleRow) {
    return { user, role: null, permissions: structuredClone(DEFAULT_DENY_ALL) }
  }

  const permissions = normalizePermissions(roleRow.permissions)
  return { user, role: { ...roleRow, permissions }, permissions }
}

/**
 * ActionResult-shaped guard for mutating server actions. Asserts a session AND
 * `capability` on `module`. Callers destructure `ctx` on success (it carries the
 * user id + scope for own-scope ownership re-checks).
 */
export async function requirePermission(
  module: ModuleKey,
  capability: Capability
): Promise<
  { ok: true; ctx: CurrentUserWithRole } | { ok: false; error: string }
> {
  const ctx = await getCurrentUserWithRole()
  if (!ctx) return { ok: false, error: UNAUTHENTICATED }
  if (!can(ctx.permissions, module, capability)) {
    return { ok: false, error: FORBIDDEN }
  }
  return { ok: true, ctx }
}
