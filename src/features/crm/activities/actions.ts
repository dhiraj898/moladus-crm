'use server'

import { revalidatePath } from 'next/cache'
import { getServiceClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/auth'
import type { Activity, ActivityEntity } from '@/lib/supabase/types'

/**
 * Server actions for the activity timeline (spec §4.5 / §5 — activities).
 *
 * Every export of a `'use server'` module becomes a publicly-callable action
 * endpoint, so this file holds ONLY the user-facing mutation `addNote`, which
 * asserts an admin session via `getCurrentUser()` first and stamps the returned
 * user id as the actor; that per-action check is the effective authorization
 * boundary (see `src/lib/supabase/auth.ts`). The internal write helper
 * `logActivity` and the read `getActivityTimeline` live in the server-only
 * module `./service` so they can never be reached as unauthenticated action
 * endpoints. All DB access goes through the server-only service-role client
 * (RLS is deny-all).
 */

/** Discriminated result returned by mutating actions. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

/** Error returned when a mutation is attempted without an admin session. */
const UNAUTHENTICATED = 'You must be signed in to do that.'

/** Map an entity to its admin detail route, used for revalidation. */
function entityPath(entityType: ActivityEntity, entityId: string): string {
  const segment =
    entityType === 'lead'
      ? 'leads'
      : entityType === 'contact'
        ? 'contacts'
        : 'deals'
  return `/admin/${segment}/${entityId}`
}

/**
 * Add a free-text note to an entity's timeline. Validates a non-empty (trimmed)
 * body, inserts a single `type='note'` row stamped with the current user as the
 * actor, revalidates the entity's detail page, and returns the saved row.
 */
export async function addNote(
  entityType: ActivityEntity,
  entityId: string,
  body: string
): Promise<ActionResult<Activity>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: UNAUTHENTICATED }

  const trimmed = body.trim()
  if (!trimmed) return { ok: false, error: 'A note cannot be empty.' }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('activities')
    .insert({
      entity_type: entityType,
      entity_id: entityId,
      type: 'note',
      actor_id: user.id,
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
