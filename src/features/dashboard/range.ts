/**
 * Pure, server-agnostic helpers for the admin dashboard (design spec §33, §43,
 * §102). No Supabase, no `server-only` — these are unit-tested in isolation.
 *
 * `resolveRange` turns the page's `?range=` / `?from=&to=` params into a date
 * window; `sumWindows` reduces daily-grain rows into current-vs-previous totals
 * for period-over-period deltas; `winRate` / `conversionRate` are guarded ratios.
 */

export type RangePreset = '7d' | '30d' | '90d' | 'ytd' | 'all'

const PRESET_DAYS: Record<Exclude<RangePreset, 'ytd' | 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

const DAY_MS = 86_400_000

/** Resolved query window. `prevStart` is null when there is no prior window (`all`). */
export interface DateWindow {
  currentStart: string
  currentEnd: string
  prevStart: string | null
}

export interface RangeParams {
  range?: string
  from?: string
  to?: string
}

/** Previous window is equal-length and immediately precedes the current one. */
function equalLengthPrev(startMs: number, endMs: number): string {
  return new Date(startMs - (endMs - startMs)).toISOString()
}

/**
 * Resolve `?range=` or `?from=&to=` into a window. Explicit valid `from`+`to`
 * wins; otherwise a known preset; otherwise (unknown/invalid) the 30d default.
 * `now` is injectable so callers and tests are deterministic.
 */
export function resolveRange(params: RangeParams = {}, now: Date = new Date()): DateWindow {
  const endMs = now.getTime()
  const currentEnd = new Date(endMs).toISOString()

  // Custom range takes precedence when both ends parse.
  const fromMs = params.from ? Date.parse(params.from) : NaN
  const toMs = params.to ? Date.parse(params.to) : NaN
  if (!Number.isNaN(fromMs) && !Number.isNaN(toMs) && fromMs <= toMs) {
    return {
      currentStart: new Date(fromMs).toISOString(),
      currentEnd: new Date(toMs).toISOString(),
      prevStart: equalLengthPrev(fromMs, toMs),
    }
  }

  const preset: RangePreset =
    params.range === '7d' ||
    params.range === '90d' ||
    params.range === 'ytd' ||
    params.range === 'all'
      ? params.range
      : '30d' // includes explicit '30d' and any invalid/unknown input

  if (preset === 'all') {
    return { currentStart: new Date(0).toISOString(), currentEnd, prevStart: null }
  }

  const startMs =
    preset === 'ytd'
      ? Date.UTC(now.getUTCFullYear(), 0, 1)
      : endMs - PRESET_DAYS[preset] * DAY_MS

  return {
    currentStart: new Date(startMs).toISOString(),
    currentEnd,
    prevStart: equalLengthPrev(startMs, endMs),
  }
}

/** A current total plus the equal-length previous total (null when no prior window). */
export interface WindowTotals {
  current: number
  previous: number | null
}

/**
 * Sum daily-grain rows into current `[currentStart, currentEnd]` vs previous
 * `[prevStart, currentStart)` totals. Rows outside both windows are ignored.
 */
export function sumWindows<T>(
  rows: readonly T[],
  window: DateWindow,
  getDay: (row: T) => string,
  getValue: (row: T) => number
): WindowTotals {
  const cs = Date.parse(window.currentStart)
  const ce = Date.parse(window.currentEnd)
  const ps = window.prevStart == null ? null : Date.parse(window.prevStart)

  let current = 0
  let previous = ps == null ? null : 0
  for (const row of rows) {
    const t = Date.parse(getDay(row))
    if (Number.isNaN(t)) continue
    if (t >= cs && t <= ce) current += getValue(row)
    else if (ps != null && t >= ps && t < cs) previous = (previous ?? 0) + getValue(row)
  }
  return { current, previous }
}

/** Win rate = won / (won + lost). Zero-denominator guard → 0. */
export function winRate(won: number, lost: number): number {
  const total = won + lost
  return total > 0 ? won / total : 0
}

/** Conversion rate = leadsWithDeal / leads. Zero-denominator guard → 0. */
export function conversionRate(leads: number, leadsWithDeal: number): number {
  return leads > 0 ? leadsWithDeal / leads : 0
}
