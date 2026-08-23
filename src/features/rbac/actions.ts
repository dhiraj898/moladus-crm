'use server'

import { revalidatePath } from 'next/cache'
import { getServiceClient } from '@/lib/supabase/server'
import { requirePermission } from './permissions'
import { normalizePermissions, ownerScopeFilter } from './can'
import { logActivity } from '@/features/crm/activities/service'
import type { Permissions, Role } from '@/lib/supabase/types'
import {
  permissionsSchema,
  roleSchema,
  type RoleInputRaw,
} from './schema'

/**
 * Mutating server actions for RBAC (spec §9.2 manual reassign + §10 role/user
 * CRUD).
 *
 * Every action asserts authorization via `requirePermission(module, capability)`
 * before touching the DB — `requirePermission` internally calls `getCurrentUser`
 * (authentication) and then checks the module capability (authorization), so
 * these actions are the effective authorization boundary (RLS is deny-all and
 * the service-role client is the only DB path). Assign actions additionally
 * re-check record ownership for own-scope callers, mirroring the read-side scope
 * filter, so a forged action id cannot write a record the caller cannot see.
 */

/** Discriminated result returned by mutating actions (matches the codebase). */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

// ---------------------------------------------------------------------------
// Manual reassignment (spec §9.2)
// ---------------------------------------------------------------------------

/**
 * Reassign a lead (spec §9.2). Requires `leads.edit`. For an own-scope role, the
 * caller must currently own the lead (an agent may only hand off their own
 * records). `assigneeUserId = null` unassigns. Logs an `edited` activity.
 */
export async function assignLead(
  leadId: string,
  assigneeUserId: string | null
): Promise<ActionResult<void>> {
  const gate = await requirePermission('leads', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }
  const { ctx } = gate

  const supabase = getServiceClient()

  // Own-scope: re-check current ownership BEFORE mutating (IDOR guard).
  const ownerId = ownerScopeFilter(ctx.permissions, 'leads', ctx.user.id)
  if (ownerId) {
    const { data: row } = await supabase
      .from('leads')
      .select('owner_id')
      .eq('id', leadId)
      .maybeSingle()
    const current = (row as { owner_id: string | null } | null)?.owner_id ?? null
    if (current !== ctx.user.id) {
      return { ok: false, error: 'You can only reassign leads assigned to you.' }
    }
  }

  const { error } = await supabase
    .from('leads')
    .update({ owner_id: assigneeUserId })
    .eq('id', leadId)
  if (error) return { ok: false, error: `Failed to assign lead: ${error.message}` }

  await logActivity('lead', leadId, 'edited', { actorId: ctx.user.id })
  revalidatePath(`/admin/leads/${leadId}`)
  revalidatePath('/admin/leads')
  return { ok: true, data: undefined }
}

/** Reassign a deal (spec §9.2). Requires `deals.edit`; own-scope ⇒ must own it. */
export async function assignDeal(
  dealId: string,
  assigneeUserId: string | null
): Promise<ActionResult<void>> {
  const gate = await requirePermission('deals', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }
  const { ctx } = gate

  const supabase = getServiceClient()

  // Own-scope: re-check current ownership BEFORE mutating (IDOR guard).
  const ownerId = ownerScopeFilter(ctx.permissions, 'deals', ctx.user.id)
  if (ownerId) {
    const { data: row } = await supabase
      .from('deals')
      .select('owner_id')
      .eq('id', dealId)
      .maybeSingle()
    const current = (row as { owner_id: string | null } | null)?.owner_id ?? null
    if (current !== ctx.user.id) {
      return { ok: false, error: 'You can only reassign deals assigned to you.' }
    }
  }

  const { error } = await supabase
    .from('deals')
    .update({ owner_id: assigneeUserId })
    .eq('id', dealId)
  if (error) return { ok: false, error: `Failed to assign deal: ${error.message}` }

  await logActivity('deal', dealId, 'edited', { actorId: ctx.user.id })
  revalidatePath(`/admin/deals/${dealId}`)
  revalidatePath('/admin/deals')
  return { ok: true, data: undefined }
}

// ---------------------------------------------------------------------------
// Role CRUD (spec §10.1) — all gated by settings.edit
// ---------------------------------------------------------------------------

const ROLES_PATH = '/admin/settings/roles'
const USERS_PATH = '/admin/settings/users'

/** Refuses de-permissioning / deleting the seeded Admin role. */
const SYSTEM_ROLE_LOCKED = 'The Admin role cannot be modified.'
const SYSTEM_ROLE_UNDELETABLE = 'System roles cannot be deleted.'

/** Create a role with a deny-all default matrix. Requires `settings.edit`. */
export async function createRole(
  input: RoleInputRaw
): Promise<ActionResult<Role>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const parsed = roleSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('roles')
    .insert({
      name: parsed.data.name,
      permissions: normalizePermissions({}), // deny-all until edited
      in_assignment_pool: false,
      is_system: false,
    })
    .select('*')
    .single()

  if (error) return { ok: false, error: `Failed to create role: ${error.message}` }

  revalidatePath(ROLES_PATH)
  const row = data as Role
  return {
    ok: true,
    data: { ...row, permissions: normalizePermissions(row.permissions) },
  }
}

/**
 * Replace a role's permission matrix. Requires `settings.edit`. Refuses to
 * modify the seeded Admin role (`is_system`) so the last admin can never be
 * de-permissioned into a lockout. The blob is normalized (fail-closed) before it
 * is stored.
 */
export async function updateRolePermissions(
  id: string,
  permissions: Permissions
): Promise<ActionResult<Role>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const parsed = permissionsSchema.safeParse(permissions)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const supabase = getServiceClient()

  // Guard: the seeded Admin role must keep its full permissions.
  const { data: roleRow, error: loadError } = await supabase
    .from('roles')
    .select('is_system')
    .eq('id', id)
    .maybeSingle()
  if (loadError) {
    return { ok: false, error: `Failed to update role: ${loadError.message}` }
  }
  if (!roleRow) return { ok: false, error: 'Role not found.' }
  if ((roleRow as { is_system: boolean }).is_system) {
    return { ok: false, error: SYSTEM_ROLE_LOCKED }
  }

  const { data, error } = await supabase
    .from('roles')
    .update({
      permissions: normalizePermissions(parsed.data),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) return { ok: false, error: `Failed to update role: ${error.message}` }

  revalidatePath(ROLES_PATH)
  const row = data as Role
  return {
    ok: true,
    data: { ...row, permissions: normalizePermissions(row.permissions) },
  }
}

/** Toggle whether a role's users receive round-robin assignments. `settings.edit`. */
export async function setRoleAssignmentPool(
  id: string,
  inPool: boolean
): Promise<ActionResult<void>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const supabase = getServiceClient()
  const { error } = await supabase
    .from('roles')
    .update({ in_assignment_pool: inPool, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { ok: false, error: `Failed to update role: ${error.message}` }

  revalidatePath(ROLES_PATH)
  return { ok: true, data: undefined }
}

/**
 * Delete a role. Requires `settings.edit`. Refused when the role is a system
 * role, or when any `profiles` row still references it (mirrors the Stages
 * "in use" delete-guard — deleting an assigned role would fail-close its users).
 */
export async function deleteRole(id: string): Promise<ActionResult<void>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const supabase = getServiceClient()

  // Guard 1: system roles are non-deletable.
  const { data: roleRow, error: loadError } = await supabase
    .from('roles')
    .select('is_system')
    .eq('id', id)
    .maybeSingle()
  if (loadError) {
    return { ok: false, error: `Failed to delete role: ${loadError.message}` }
  }
  if (!roleRow) return { ok: false, error: 'Role not found.' }
  if ((roleRow as { is_system: boolean }).is_system) {
    return { ok: false, error: SYSTEM_ROLE_UNDELETABLE }
  }

  // Guard 2: the role cannot be in use by any user.
  const { count, error: usageError } = await supabase
    .from('profiles')
    .select('user_id', { count: 'exact', head: true })
    .eq('role_id', id)
  if (usageError) {
    return { ok: false, error: `Failed to delete role: ${usageError.message}` }
  }
  if ((count ?? 0) > 0) {
    return { ok: false, error: 'Role is assigned to one or more users.' }
  }

  const { error } = await supabase.from('roles').delete().eq('id', id)
  if (error) return { ok: false, error: `Failed to delete role: ${error.message}` }

  revalidatePath(ROLES_PATH)
  return { ok: true, data: undefined }
}

// ---------------------------------------------------------------------------
// User → role mapping (spec §10.2) — gated by settings.edit
// ---------------------------------------------------------------------------

/**
 * Assign (or change / clear) a user's role. Requires `settings.edit`. Upserts
 * the `profiles` row keyed by `user_id`. Self-lockout guard: refuses to strip
 * the last user holding a system (Admin) role, so an admin can never
 * accidentally lock every administrator out of the system.
 */
export async function assignUserRole(
  userId: string,
  roleId: string | null
): Promise<ActionResult<void>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const supabase = getServiceClient()

  // Resolve the set of system (Admin) role ids for the self-lockout guard.
  const { data: sysRoles, error: sysError } = await supabase
    .from('roles')
    .select('id')
    .eq('is_system', true)
  if (sysError) {
    return { ok: false, error: `Failed to assign role: ${sysError.message}` }
  }
  const systemRoleIds = new Set(
    ((sysRoles ?? []) as { id: string }[]).map((r) => r.id)
  )

  // The user's current role, to know whether this change drops a system role.
  const { data: profileRow, error: profileError } = await supabase
    .from('profiles')
    .select('role_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (profileError) {
    return { ok: false, error: `Failed to assign role: ${profileError.message}` }
  }
  const currentRoleId =
    (profileRow as { role_id: string | null } | null)?.role_id ?? null

  const currentlyAdmin = currentRoleId !== null && systemRoleIds.has(currentRoleId)
  const willBeAdmin = roleId !== null && systemRoleIds.has(roleId)

  // Self-lockout guard: block dropping the last remaining administrator.
  if (currentlyAdmin && !willBeAdmin) {
    const { count, error: countError } = await supabase
      .from('profiles')
      .select('user_id', { count: 'exact', head: true })
      .in('role_id', Array.from(systemRoleIds))
    if (countError) {
      return { ok: false, error: `Failed to assign role: ${countError.message}` }
    }
    if ((count ?? 0) <= 1) {
      return { ok: false, error: 'Cannot remove the last administrator.' }
    }
  }

  const { error } = await supabase
    .from('profiles')
    .upsert(
      { user_id: userId, role_id: roleId, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
  if (error) return { ok: false, error: `Failed to assign role: ${error.message}` }

  revalidatePath(USERS_PATH)
  return { ok: true, data: undefined }
}

/**
 * Invite a new admin user by email (spec: in-app team provisioning). Requires
 * `settings.edit`. Creates the Supabase Auth user via the admin invite API,
 * which emails them a set-password link — NO password is ever handled, stored,
 * or shown in this app. When `roleId` is provided, the invited user's role is
 * assigned immediately by upserting their `profiles` row. Idempotent-ish:
 * inviting an existing email returns a friendly error rather than duplicating.
 */
export async function inviteUser(input: {
  email: string
  roleId: string | null
}): Promise<ActionResult<{ userId: string }>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const email = input.email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      ok: false,
      error: 'Enter a valid email address.',
      fieldErrors: { email: ['Enter a valid email address.'] },
    }
  }

  const supabase = getServiceClient()
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email)

  if (error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exist')) {
      return { ok: false, error: 'A user with this email already exists.' }
    }
    if (msg.includes('smtp') || msg.includes('email') || msg.includes('send')) {
      return {
        ok: false,
        error: `Could not send the invite email — check Supabase email settings. (${error.message})`,
      }
    }
    return { ok: false, error: `Could not invite user: ${error.message}` }
  }

  const userId = data.user?.id
  if (!userId) {
    return { ok: false, error: 'Invite succeeded but no user id was returned.' }
  }

  // Assign the chosen role immediately, if any.
  if (input.roleId) {
    const { error: roleError } = await supabase
      .from('profiles')
      .upsert(
        {
          user_id: userId,
          role_id: input.roleId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
    if (roleError) {
      // The user was invited; surface the role failure so the admin can retry
      // the assignment from the table (the user now appears there).
      revalidatePath(USERS_PATH)
      return {
        ok: false,
        error: `User invited, but assigning the role failed: ${roleError.message}. Set their role from the list.`,
      }
    }
  }

  revalidatePath(USERS_PATH)
  return { ok: true, data: { userId } }
}
