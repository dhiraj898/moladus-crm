'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { FilterDef } from './types'

/**
 * Renders a list's declared filters as URL query params (design §"FilterBar —
 * renders a page's declared filters … as URL query params; a Reset"). Only the
 * keys present in `filters` render. Search inputs are debounced; selects and
 * date inputs commit on change. Every commit pushes the new querystring via
 * `router.replace` (no history spam), preserving the current `?view=` and any
 * unrelated params, and resetting to page 0 semantics is the caller's concern.
 *
 * The bar is server-driven: changing a param triggers a navigation and the
 * server component re-fetches the filtered rows. `values` seeds the controls
 * from the current URL so the inputs stay in sync after a filter change.
 */

const SEARCH_DEBOUNCE_MS = 300

export default function FilterBar({
  filters,
  values,
}: {
  filters: FilterDef[]
  values: Record<string, string>
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Local mirror of the search inputs so typing is responsive; committed
  // (debounced) to the URL. Non-search controls commit immediately.
  const [searchDraft, setSearchDraft] = useState<Record<string, string>>({})
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reseed the search drafts whenever the URL values change (e.g. Reset, or a
  // shared link). Keyed on the serialised values so it only runs on real change.
  const valuesKey = JSON.stringify(values)
  useEffect(() => {
    const next: Record<string, string> = {}
    for (const f of filters) {
      if (f.type === 'search') next[f.key] = values[f.key] ?? ''
    }
    setSearchDraft(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesKey])

  /** Write one filter key to the URL, preserving every other param. */
  const commit = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) params.set(key, value)
      else params.delete(key)
      // Any filter change resets pagination to page 1 (the current offset is
      // meaningless against a newly filtered set); page 1 is the absent-param
      // default, so we drop the key. `pageSize` is a display preference, not a
      // filter, so it is preserved.
      params.delete('page')
      const query = params.toString()
      router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false })
    },
    [router, pathname, searchParams]
  )

  const handleSearchChange = useCallback(
    (key: string, value: string) => {
      setSearchDraft((prev) => ({ ...prev, [key]: value }))
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        commit(key, value.trim())
      }, SEARCH_DEBOUNCE_MS)
    },
    [commit]
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  /** Reset drops every declared filter key, preserving `?view=` + others. */
  const handleReset = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    for (const f of filters) params.delete(f.key)
    // Reset also drops pagination to page 1 (the filtered set changed).
    params.delete('page')
    const query = params.toString()
    router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false })
  }, [router, pathname, searchParams, filters])

  const hasActive = filters.some((f) => (values[f.key] ?? '') !== '')

  if (filters.length === 0) return null

  return (
    <div className="mb-5 flex flex-wrap items-end gap-3 rounded-[12px] border border-line bg-surface p-4">
      {filters.map((f) => {
        if (f.type === 'search') {
          return (
            <label
              key={f.key}
              className="flex min-w-[220px] flex-1 flex-col gap-1.5"
            >
              <span className="text-xs font-semibold text-dim">{f.label}</span>
              <input
                type="search"
                value={searchDraft[f.key] ?? ''}
                onChange={(e) => handleSearchChange(f.key, e.target.value)}
                placeholder={f.label}
                className="rounded-[8px] border border-line bg-bg px-3 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-accent"
              />
            </label>
          )
        }
        if (f.type === 'select') {
          return (
            <label key={f.key} className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-dim">{f.label}</span>
              <select
                value={values[f.key] ?? ''}
                onChange={(e) => commit(f.key, e.target.value)}
                className="rounded-[8px] border border-line bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent"
              >
                <option value="">All</option>
                {(f.options ?? []).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          )
        }
        // date
        return (
          <label key={f.key} className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-dim">{f.label}</span>
            <input
              type="date"
              value={values[f.key] ?? ''}
              onChange={(e) => commit(f.key, e.target.value)}
              className="rounded-[8px] border border-line bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent"
            />
          </label>
        )
      })}

      {hasActive ? (
        <button
          type="button"
          onClick={handleReset}
          className="rounded-[8px] border border-line bg-surface px-4 py-2 text-sm font-medium text-dim transition-colors hover:bg-surface2 hover:text-text"
        >
          Reset
        </button>
      ) : null}
    </div>
  )
}
