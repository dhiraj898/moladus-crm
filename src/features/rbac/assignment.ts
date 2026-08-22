import 'server-only'
import { getServiceClient } from '@/lib/supabase/server'

/**
 * Round-robin auto-assignment (spec §9.1).
 *
 * `pickRoundRobin` is a pure, dependency-free function (unit-tested via
 * `assignment.test.ts`). `assignNext` is the server-only resolver that queries
 * the assignment pool, reads/advances the persistent cursor, and returns the
 * chosen agent's user id. The whole file carries `import 'server-only'`; Vitest
 * aliases `server-only` to a noop so the pure picker stays testable.
 */

/**
 * Next user id after the cursor in a stable, ordered pool, wrapping around.
 * Returns null for an empty pool. A null cursor, or a cursor no longer present
 * in the pool (a pool member left since the last assignment), starts at index 0.
 */
export function pickRoundRobin(
  poolUserIds: string[],
  lastAssignedUserId: string | null
): string | null {
  if (poolUserIds.length === 0) return null
  const last = lastAssignedUserId
    ? poolUserIds.indexOf(lastAssignedUserId)
    : -1
  const next = (last + 1) % poolUserIds.length
  return poolUserIds[next]
}

/** Singleton cursor key for the round-robin state row. */
const CURSOR_KEY = 'round_robin'

/**
 * Assign a new submission to the next agent in the pool (spec §9.1).
 *
 * Pool = users whose role.in_assignment_pool = true, ordered by user_id (stable).
 * Reads the persistent cursor, picks the next user, persists the new cursor, and
 * returns the chosen user id — or null when the pool is empty (record left
 * unassigned; visible only to `all`-scope roles). Best-effort: any error returns
 * null so ingest never fails on assignment.
 */
export async function assignNext(): Promise<string | null> {
  try {
    const supabase = getServiceClient()

    // Pool: profiles whose role is flagged in_assignment_pool, stable order.
    const { data: poolRows, error: poolError } = await supabase
      .from('profiles')
      .select('user_id, role:roles!inner (in_assignment_pool)')
      .eq('role.in_assignment_pool', true)
      .order('user_id', { ascending: true })
    if (poolError) return null

    const pool = ((poolRows ?? []) as unknown as { user_id: string }[]).map(
      (r) => r.user_id
    )
    if (pool.length === 0) return null

    // Cursor.
    const { data: stateRow } = await supabase
      .from('assignment_state')
      .select('last_user_id')
      .eq('key', CURSOR_KEY)
      .maybeSingle()
    const last =
      (stateRow as { last_user_id: string | null } | null)?.last_user_id ?? null

    const chosen = pickRoundRobin(pool, last)
    if (!chosen) return null

    // Persist the new cursor (upsert so a missing seed row self-heals).
    await supabase
      .from('assignment_state')
      .upsert(
        {
          key: CURSOR_KEY,
          last_user_id: chosen,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      )

    return chosen
  } catch {
    return null
  }
}
