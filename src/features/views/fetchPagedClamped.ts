import {
  clampPage,
  offsetFor,
  parseRequestedPage,
  type PageSize,
} from './paginationMath'

/**
 * The row window a list page hands to its view: the fetched `rows`, the `total`
 * matching count, and the *clamped* `page` actually served (which may differ
 * from the URL's `?page` on overshoot — see below).
 */
export interface ClampedPage<T> {
  rows: T[]
  total: number
  page: number
}

/**
 * Fetch one Table/List page, clamping the requested page to `[1, pageCount]`
 * *after* the total is known (plan Task 1.1; design §"Table/List pagination").
 *
 * The catch this closes: the requested page is parsed from the URL before the
 * total row count exists, so an out-of-range `?page` (a bookmarked/shared link,
 * or a dataset that shrank since the link was made) would offset past `total`,
 * the DB window would return zero rows, and the table would render its empty
 * state ("No X found") even though records exist — while the footer clamps to
 * "Page {last} of {last}". This helper detects that overshoot and re-fetches
 * the real last page, so a valid clamped page number always shows its rows.
 *
 * The common case (in-range page) costs a single `fetcher` call; the corrective
 * re-fetch runs only on the rare overshoot. `fetcher` re-derives its own scope +
 * filters, so the offset can never widen access — only the row window changes.
 *
 * @param requestedPageValue raw `?page` param (`string | string[] | undefined`)
 * @param pageSize already clamped page size (see `clampPageSize`)
 * @param fetcher runs the paged query for a given `{ offset, limit }` window
 */
export async function fetchPagedClamped<T>(
  requestedPageValue: unknown,
  pageSize: PageSize,
  fetcher: (window: {
    offset: number
    limit: number
  }) => Promise<{ rows: T[]; total: number }>
): Promise<ClampedPage<T>> {
  const requestedPage = parseRequestedPage(requestedPageValue)
  const initial = await fetcher({
    offset: offsetFor(requestedPage, pageSize),
    limit: pageSize,
  })

  const page = clampPage(requestedPage, initial.total, pageSize)
  if (page === requestedPage) {
    return { rows: initial.rows, total: initial.total, page }
  }

  // Overshoot: `?page` was past the last page. Re-fetch the clamped last page so
  // its records show instead of an empty table.
  const corrected = await fetcher({
    offset: offsetFor(page, pageSize),
    limit: pageSize,
  })
  return { rows: corrected.rows, total: corrected.total, page }
}
