'use server'

import { revalidatePath } from 'next/cache'
import { getServiceClient } from '@/lib/supabase/server'
import { requirePermission } from '@/features/rbac/permissions'
import { scopeFor } from '@/features/rbac/can'
import type {
  Activity,
  ActivityEntity,
  ModuleKey,
} from '@/lib/supabase/types'

/**
 * Server actions for the activity timeline (spec §4.5 / §5 — activities).
 *
 * Every export of a `'use server'` module becomes a publicly-callable action
 * endpoint, so this file holds ONLY the user-facing mutation `addNote`, which
 * asserts `requirePermission(moduleKey, 'edit')` for the note's entity module first
 * (which internally calls `getCurrentUser()` — authentication — then checks the
 * capability — authorization) and stamps `ctx.user.id` as the actor. For an
 * own-scope role on a scoped module (leads/deals) it additionally re-checks
 * ownership BEFORE inserting, so an agent cannot annotate a record they cannot
 * see. The internal write helper `logActivity` and the read
 * `getActivityTimeline` live in the server-only module `./service` so they can
 * never be reached as unauthenticated action endpoints. All DB access goes
 * through the server-only service-role client (RLS is deny-all).
 */

/** Discriminated result returned by mutating actions. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

/** Returned when an own-scope caller targets a record they do not own. */
const NOT_FOUND = 'Not found'

/** The module (and its DB table) an activity entity belongs to. */
const ENTITY_MODULE: Record<ActivityEntity, ModuleKey> = {
  lead: 'leads',
  contact: 'contacts',
  deal: 'deals',
}

/** Map an entity to its admin detail route, used for revalidation. */
function entityPath(entityType: ActivityEntity, entityId: string): string {
  return `/admin/${ENTITY_MODULE[entityType]}/${entityId}`
}

/**
 * Add a free-text note to an entity's timeline. Requires `edit` on the entity's
 * module; for an own-scope leads/deals role the caller must own the record.
 * Validates a non-empty (trimmed) body, inserts a single `type='note'` row
 * stamped with the current user as the actor, revalidates the entity's detail
 * page, and returns the saved row.
 */
export async function addNote(
  entityType: ActivityEntity,
  entityId: string,
  body: string
): Promise<ActionResult<Activity>> {
  const moduleKey = ENTITY_MODULE[entityType]
  const gate = await requirePermission(moduleKey, 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }
  const { ctx } = gate

  const trimmed = body.trim()
  if (!trimmed) return { ok: false, error: 'A note cannot be empty.' }

  const supabase = getServiceClient()

  // Own-scope IDOR guard on the scoped modules: refuse a record the caller does
  // not own, BEFORE inserting the note.
  if (
    (moduleKey === 'leads' || moduleKey === 'deals') &&
    scopeFor(ctx.permissions, moduleKey) === 'own'
  ) {
    const { data: row } = await supabase
      .from(moduleKey)
      .select('owner_id')
      .eq('id', entityId)
      .maybeSingle()
    const owner = (row as { owner_id: string | null } | null)?.owner_id ?? null
    if (owner !== ctx.user.id) return { ok: false, error: NOT_FOUND }
  }

  const { data, error } = await supabase
    .from('activities')
    .insert({
      entity_type: entityType,
      entity_id: entityId,
      type: 'note',
      actor_id: ctx.user.id,
      body: trimmed,
      metadata: {},
    })
    .select('*')
    .single()

  if (error) {
    return { ok: false, error: `Failed to add note: ${error.message}` }
  }

  revalidatePath(entityPath(entityType, entityId))
  return { ok: true, data: data as Activity }
}
