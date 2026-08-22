import 'server-only'
import { getServiceClient } from '@/lib/supabase/server'
import type { Activity, ActivityEntity, ActivityType } from '@/lib/supabase/types'

/**
 * Server-only helpers for the activity timeline (spec §4.5 / §5 — activities).
 *
 * These are deliberately kept OUT of the `'use server'` actions module. Next.js
 * turns every export of a `'use server'` file into a publicly-callable action
 * endpoint keyed by a stable action id; an internal write helper or a read
 * placed there would be invokable without a session and is not covered by the
 * `/admin/:path*` middleware — an attacker holding the action id could forge
 * timeline rows with an arbitrary actor id, or enumerate/disclose timeline
 * bodies and admin emails. As plain server functions (guarded by
 * `import 'server-only'`, matching `src/features/records/queries.ts` and
 * `src/features/forms/queries.ts`) these are callable only from server
 * components / other server code, never from the client.
 *
 * The `activities` table is the timeline source of truth. All DB access goes
 * through the server-only service-role client (RLS is deny-all).
 */

/** An activity row plus the resolved email of its actor (null for system). */
export type ActivityView = Activity & { actor_email: string | null }

/**
 * Internal helper that records a system/side-effect activity. Unlike `addNote`,
 * it does not require an authenticated user — the caller passes `actorId`
 * explicitly (or leaves it null for pure system events). Best-effort: any
 * failure is logged and swallowed so it can never break the primary write that
 * triggered it (e.g. a webhook ack or a stage change that already committed).
 *
 * This is NOT a server action: it is only reachable from other server code, so
 * the `actorId` it stamps is always supplied by trusted callers.
 */
export async function logActivity(
  entityType: ActivityEntity,
  entityId: string,
  type: ActivityType,
  opts: {
    body?: string | null
    metadata?: Record<string, unknown>
    actorId?: string | null
  } = {}
): Promise<void> {
  try {
    const supabase = getServiceClient()
    const { error } = await supabase.from('activities').insert({
      entity_type: entityType,
      entity_id: entityId,
      type,
      actor_id: opts.actorId ?? null,
      body: opts.body ?? null,
      metadata: opts.metadata ?? {},
    })
    if (error) {
      console.error(`logActivity(${type}) failed: ${error.message}`)
    }
  } catch (err) {
    console.error('logActivity threw:', err)
  }
}

/**
 * Load an entity's timeline, newest first, with each actor id resolved to an
 * email for display. Actor emails are resolved via the Auth admin API and
 * memoised in a per-request cache (admins are few, so distinct actors per
 * timeline are minimal). A resolution failure degrades gracefully to a null
 * email rather than failing the whole page.
 */
export async function getActivityTimeline(
  entityType: ActivityEntity,
  entityId: string
): Promise<ActivityView[]> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to load activity timeline: ${error.message}`)
  }

  const rows = (data ?? []) as Activity[]

  // Per-request cache: actor id → email (null when unresolved / system).
  const emailCache = new Map<string, string | null>()

  async function resolveEmail(actorId: string | null): Promise<string | null> {
    if (!actorId) return null
    if (emailCache.has(actorId)) return emailCache.get(actorId) ?? null
    try {
      const { data: userData, error: userError } =
        await supabase.auth.admin.getUserById(actorId)
      const email = userError ? null : (userData.user?.email ?? null)
      emailCache.set(actorId, email)
      return email
    } catch {
      emailCache.set(actorId, null)
      return null
    }
  }

  const views: ActivityView[] = []
  for (const row of rows) {
    views.push({ ...row, actor_email: await resolveEmail(row.actor_id) })
  }
  return views
}
