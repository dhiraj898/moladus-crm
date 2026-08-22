import 'server-only'
import { getServiceClient } from '@/lib/supabase/server'
import { normalizePermissions } from './can'
import type { Role } from '@/lib/supabase/types'

/**
 * Server-only reads for the RBAC admin screens (spec §8 — Roles + Users). Like
 * every RBAC data path these run through the service-role client (RLS is
 * deny-all) and are guarded by `import 'server-only'`, so they are callable only
 * from server components/actions — never as an unauthenticated endpoint. The
 * mutating actions that consume these lists still assert `requirePermission`;
 * these are plain loaders for rendering the screens.
 */

/**
 * List every role, system roles first then alphabetical. Each role's stored
 * permissions blob is run through {@link normalizePermissions} so the UI always
 * receives a complete, fail-closed matrix (never a partial/corrupt blob).
 */
export async function listRoles(): Promise<Role[]> {
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('roles')
    .select('*')
    .order('is_system', { ascending: false })
    .order('name', { ascending: true })

  if (error) throw new Error(`Failed to list roles: ${error.message}`)

  return ((data ?? []) as unknown as Role[]).map((role) => ({
    ...role,
    permissions: normalizePermissions(role.permissions),
  }))
}

/** A user offered in the assignment / role-management pickers. */
export interface AssignableUser {
  id: string
  email: string | null
  roleId: string | null
  roleName: string | null
}

/** Auth admin returns users in pages; this caps how many pages we walk. */
const MAX_USER_PAGES = 100
const USER_PAGE_SIZE = 1000

/**
 * List every admin user with their assigned role, for the users screen and the
 * assignment picker. Users come from the Auth admin API (the system of record
 * for identities); roles come from `profiles` joined to `roles`. The two are
 * joined in memory — a user with no profile row resolves to a null role rather
 * than being dropped, so no account silently disappears from the admin list.
 */
export async function listAssignableUsers(): Promise<AssignableUser[]> {
  const supabase = getServiceClient()

  // Load profiles + role names once; index by user id for the in-memory join.
  const [{ data: profileRows, error: profileError }, { data: roleRows, error: roleError }] =
    await Promise.all([
      supabase.from('profiles').select('user_id, role_id'),
      supabase.from('roles').select('id, name'),
    ])

  if (profileError) {
    throw new Error(`Failed to load profiles: ${profileError.message}`)
  }
  if (roleError) {
    throw new Error(`Failed to load roles: ${roleError.message}`)
  }

  const roleNameById = new Map<string, string>()
  for (const r of (roleRows ?? []) as { id: string; name: string }[]) {
    roleNameById.set(r.id, r.name)
  }

  const roleIdByUser = new Map<string, string | null>()
  for (const p of (profileRows ?? []) as {
    user_id: string
    role_id: string | null
  }[]) {
    roleIdByUser.set(p.user_id, p.role_id)
  }

  // Page through the Auth admin user list until a short (final) page.
  const users: AssignableUser[] = []
  for (let page = 1; page <= MAX_USER_PAGES; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: USER_PAGE_SIZE,
    })
    if (error) throw new Error(`Failed to list users: ${error.message}`)

    const pageUsers = data.users
    for (const u of pageUsers) {
      const roleId = roleIdByUser.get(u.id) ?? null
      users.push({
        id: u.id,
        email: u.email ?? null,
        roleId,
        roleName: roleId ? (roleNameById.get(roleId) ?? null) : null,
      })
    }

    if (pageUsers.length < USER_PAGE_SIZE) break
  }

  return users
}
