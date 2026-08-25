'use client'

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  clampPage,
  clampPageSize,
  pageCount,
} from './paginationMath'

/**
 * Table/List pagination control (plan Task 1.3; design §"Table/List
 * pagination"). Renders "N results · Page X of Y", Prev/Next (disabled at the
 * ends), and a page-size `<select>`. All three write `?page`/`?pageSize` to the
 * URL via {@link useRouter}.replace — the URL is the source of truth; the server
 * page re-reads them and fetches the matching window. Every other param
 * (`?view=`, active filters) is preserved on each write.
 *
 * The default page (1) and default page size (25) are written as *absent*
 * params so URLs stay clean and a fresh list and page 1 share one URL. Changing
 * the page size resets `page` to 1 (the current offset is meaningless at a new
 * size), mirroring the FilterBar's page-reset on a filter change.
 *
 * Design tokens throughout (Inter, dark-default, `--accent`, `--line`,
 * `--surface`), matching the FilterBar controls.
 */
export default function Pagination({
  total,
  page,
  pageSize,
}: {
  total: number
  page: number
  pageSize: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const size = clampPageSize(pageSize)
  const pages = pageCount(total, size)
  const current = clampPage(page, total, size)

  /** Rewrite `page`/`pageSize` on the URL, preserving every other param. */
  const commit = useCallback(
    (nextPage: number, nextSize: number) => {
      const params = new URLSearchParams(searchParams.toString())

      if (nextPage > 1) params.set('page', String(nextPage))
      else params.delete('page')

      if (nextSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(nextSize))
      else params.delete('pageSize')

      const query = params.toString()
      router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false })
    },
    [router, pathname, searchParams]
  )

  const goPrev = useCallback(() => {
    if (current > 1) commit(current - 1, size)
  }, [commit, current, size])

  const goNext = useCallback(() => {
    if (current < pages) commit(current + 1, size)
  }, [commit, current, pages, size])

  // Changing the page size resets to page 1 — the old offset is meaningless.
  const changeSize = useCallback(
    (value: string) => {
      commit(1, clampPageSize(value))
    },
    [commit]
  )

  const atStart = current <= 1
  const atEnd = current >= pages

  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-surface px-4 py-3"
    >
      <p className="text-sm text-dim">
        <span className="font-medium text-text">
          {total.toLocaleString('en-IN')}
        </span>{' '}
        {total === 1 ? 'result' : 'results'} · Page{' '}
        <span className="font-medium text-text">{current}</span> of {pages}
      </p>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-dim">
          <span className="hidden sm:inline">Per page</span>
          <select
            aria-label="Results per page"
            value={size}
            onChange={(e) => changeSize(e.target.value)}
            className="rounded-[8px] border border-line bg-bg px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goPrev}
            disabled={atStart}
            aria-label="Previous page"
            className="rounded-[8px] border border-line bg-surface px-3 py-1.5 text-sm font-medium text-text transition-colors hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={atEnd}
            aria-label="Next page"
            className="rounded-[8px] border border-line bg-surface px-3 py-1.5 text-sm font-medium text-text transition-colors hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface"
          >
            Next
          </button>
        </div>
      </div>
    </nav>
  )
}
