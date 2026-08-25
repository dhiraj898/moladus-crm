import { describe, it, expect, vi } from 'vitest'
import { fetchPagedClamped } from './fetchPagedClamped'

/**
 * Unit tests for the clamp-then-fetch pagination helper (plan Task 1.1). The
 * central case is the overshoot correction: an out-of-range `?page` must serve
 * the real last page's rows, not an empty window.
 */

/** A fetcher over a fixed pool of `total` rows, respecting the window. */
function poolFetcher(total: number) {
  const pool = Array.from({ length: total }, (_, i) => i)
  return vi.fn(
    async ({ offset, limit }: { offset: number; limit: number }) => ({
      rows: pool.slice(offset, offset + limit),
      total,
    })
  )
}

describe('fetchPagedClamped', () => {
  it('serves an in-range page with a single fetch', async () => {
    const fetcher = poolFetcher(100)
    const result = await fetchPagedClamped('2', 25, fetcher)

    expect(result.page).toBe(2)
    expect(result.total).toBe(100)
    expect(result.rows).toEqual(Array.from({ length: 25 }, (_, i) => 25 + i))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith({ offset: 25, limit: 25 })
  })

  it('corrects an out-of-range page to the last page with a re-fetch', async () => {
    const fetcher = poolFetcher(60) // 60 rows / 25 = 3 pages
    const result = await fetchPagedClamped('999', 25, fetcher)

    // Clamped to the last page (3), whose rows must be non-empty.
    expect(result.page).toBe(3)
    expect(result.total).toBe(60)
    expect(result.rows).toEqual([50, 51, 52, 53, 54, 55, 56, 57, 58, 59])
    expect(fetcher).toHaveBeenCalledTimes(2)
    // Overshoot offset first, then the corrected last-page offset.
    expect(fetcher).toHaveBeenNthCalledWith(1, { offset: 24950, limit: 25 })
    expect(fetcher).toHaveBeenNthCalledWith(2, { offset: 50, limit: 25 })
  })

  it('treats an empty result as page 1 of 1 without a re-fetch', async () => {
    const fetcher = poolFetcher(0)
    const result = await fetchPagedClamped('5', 25, fetcher)

    expect(result.page).toBe(1)
    expect(result.total).toBe(0)
    expect(result.rows).toEqual([])
    // requestedPage 5 !== clamped 1, so one corrective re-fetch runs.
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('collapses junk / below-1 page params to page 1 (single fetch)', async () => {
    const fetcher = poolFetcher(100)
    const result = await fetchPagedClamped(undefined, 25, fetcher)

    expect(result.page).toBe(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith({ offset: 0, limit: 25 })
  })
})
