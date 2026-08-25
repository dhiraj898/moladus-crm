/**
 * Kanban grouping helper (design §"KanbanBoard"; plan Task 2.1). Pure — no DB,
 * no RBAC. Buckets a flat, already-scoped row set into columns keyed by the
 * declared column id so the client can render one draggable column per bucket.
 */

/**
 * Synthetic bucket id for rows whose grouping value is null or does not match
 * any declared column (e.g. a lead whose status has been retired). The bucket is
 * created lazily — it appears only when at least one row lands in it.
 */
export const UNASSIGNED = '__unassigned'

/**
 * Group `rows` into a record keyed by column id.
 *
 * - Every declared column id in `columns` is present as a key, even when its
 *   bucket is empty, so the board always renders a column per declared group.
 * - A row whose `getColumnId` value is `null` or is not one of the declared
 *   column ids is routed to the {@link UNASSIGNED} bucket. That bucket is only
 *   added when something lands in it.
 * - Row order is preserved within each bucket.
 */
export function groupRows<T>(
  rows: T[],
  getColumnId: (row: T) => string | null,
  columns: { id: string }[]
): Record<string, T[]> {
  const grouped: Record<string, T[]> = {}
  const known = new Set<string>()
  for (const col of columns) {
    grouped[col.id] = []
    known.add(col.id)
  }

  for (const row of rows) {
    const id = getColumnId(row)
    const bucket = id !== null && known.has(id) ? id : UNASSIGNED
    ;(grouped[bucket] ??= []).push(row)
  }

  return grouped
}
