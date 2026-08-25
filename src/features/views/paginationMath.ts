/**
 * Pure page-math for the Table/List pagination control (plan Task 1.1; design
 * §"Table/List pagination"). No DB, no React — just the clamping + offset
 * arithmetic shared by the server pages (which read `?page`/`?pageSize`, clamp
 * them, and compute the `.range()` window) and the client {@link
 * import('./Pagination').default} control (which renders "Page X of Y").
 *
 * Contract:
 * - `pageSize` is clamped to one of {@link PAGE_SIZES} (default 25); anything
 *   else — junk, `undefined`, an out-of-set number — falls back to 25.
 * - `page` is 1-based and clamped to `[1, pageCount]`.
 * - `pageCount` is at least 1 (an empty result is still "Page 1 of 1").
 */

/** The selectable page sizes; `PAGE_SIZES[0]` (25) is the default. */
export const PAGE_SIZES = [25, 50, 100] as const

/** One of the allowed page sizes. */
export type PageSize = (typeof PAGE_SIZES)[number]

/** The default page size (first of {@link PAGE_SIZES}). */
export const DEFAULT_PAGE_SIZE: PageSize = PAGE_SIZES[0]

/**
 * Coerce an arbitrary value (a URL param, which is `string | undefined`, or a
 * number) to a whitelisted {@link PageSize}. Only an exact member of
 * {@link PAGE_SIZES} passes; everything else — undefined, junk, `30`, `"abc"` —
 * falls back to {@link DEFAULT_PAGE_SIZE}.
 */
export function clampPageSize(value: unknown): PageSize {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : NaN
  return (PAGE_SIZES as readonly number[]).includes(n)
    ? (n as PageSize)
    : DEFAULT_PAGE_SIZE
}

/**
 * Total number of pages for `total` rows at `pageSize` per page — `ceil`, never
 * below 1 (so an empty list is still "Page 1 of 1"). A non-positive or
 * non-finite `pageSize` degrades to 1 page.
 */
export function pageCount(total: number, pageSize: number): number {
  if (!Number.isFinite(pageSize) || pageSize <= 0) return 1
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 0
  return Math.max(1, Math.ceil(safeTotal / pageSize))
}

/**
 * Coerce an arbitrary `page` value to a valid 1-based page number in
 * `[1, pageCount(total, pageSize)]`. Junk, `undefined`, `0`, and negatives clamp
 * to 1; values past the last page clamp down to the last page.
 */
export function clampPage(
  page: unknown,
  total: number,
  pageSize: number
): number {
  const n =
    typeof page === 'number'
      ? page
      : typeof page === 'string'
        ? Number(page)
        : NaN
  const last = pageCount(total, pageSize)
  if (!Number.isFinite(n)) return 1
  const floored = Math.floor(n)
  if (floored < 1) return 1
  if (floored > last) return last
  return floored
}

/**
 * Zero-based row offset for a 1-based `page` — `(page - 1) * pageSize`, the
 * lower bound handed to Supabase `.range(offset, offset + limit - 1)`.
 */
export function offsetFor(page: number, pageSize: number): number {
  return (page - 1) * pageSize
}
