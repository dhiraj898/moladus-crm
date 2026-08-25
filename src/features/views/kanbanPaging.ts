/**
 * Pure paging math + arg validation for the Kanban "Load more" flow (plan Task
 * 3.1; design §"Kanban pagination"). No DB, no React — the offset clamp + the
 * fixed per-column window shared by the `loadColumnRows` data fn, the load-more
 * server actions, and the client {@link import('./KanbanBoard').default} board.
 *
 * Contract:
 * - Each column shows at most {@link KANBAN_COLUMN_LIMIT} rows per fetch; the
 *   board caps a column's initial render at that many and each "Load more"
 *   fetches the next {@link KANBAN_COLUMN_LIMIT}.
 * - An offset (the count of already-loaded rows) is floored and never negative,
 *   so a forged/garbage offset can only re-read from the top, never underflow.
 * - `entity` is whitelisted to the two boards that offer Kanban.
 */

/** Per-column row cap — the initial render size and each "Load more" page. */
export const KANBAN_COLUMN_LIMIT = 50

/** The two entities whose list pages offer a Kanban board. */
export type KanbanEntity = 'deals' | 'leads'

/** Type-guard: is `value` one of the Kanban-capable entities? */
export function isKanbanEntity(value: unknown): value is KanbanEntity {
  return value === 'deals' || value === 'leads'
}

/**
 * Coerce an arbitrary offset (a client-supplied "rows already loaded" count) to
 * a safe zero-based row offset: floored, finite, never below 0. Junk,
 * `undefined`, negatives, and fractions all collapse to a valid offset.
 */
export function clampColumnOffset(value: unknown): number {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : NaN
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

/**
 * The `[offset, offset + limit)` window for a column "Load more": the clamped
 * offset plus the fixed {@link KANBAN_COLUMN_LIMIT}. Handed to Supabase
 * `.range(offset, offset + limit - 1)` by `loadColumnRows`.
 */
export function columnWindow(offset: unknown): { offset: number; limit: number } {
  return { offset: clampColumnOffset(offset), limit: KANBAN_COLUMN_LIMIT }
}
