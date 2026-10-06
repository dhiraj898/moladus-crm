import { describe, expect, it } from 'vitest'
import {
  conversionRate,
  resolveRange,
  sumWindows,
  winRate,
  type DateWindow,
} from './range'

const NOW = new Date('2026-10-06T12:00:00.000Z')
const DAY_MS = 86_400_000

describe('resolveRange (spec §44, §104)', () => {
  it('30d preset: equal-length previous window immediately precedes current', () => {
    const w = resolveRange({ range: '30d' }, NOW)
    expect(w.currentEnd).toBe(NOW.toISOString())
    expect(w.currentStart).toBe(new Date(NOW.getTime() - 30 * DAY_MS).toISOString())
    expect(w.prevStart).toBe(new Date(NOW.getTime() - 60 * DAY_MS).toISOString())
  })

  it('7d and 90d presets span the right number of days', () => {
    expect(resolveRange({ range: '7d' }, NOW).currentStart).toBe(
      new Date(NOW.getTime() - 7 * DAY_MS).toISOString()
    )
    expect(resolveRange({ range: '90d' }, NOW).currentStart).toBe(
      new Date(NOW.getTime() - 90 * DAY_MS).toISOString()
    )
  })

  it('ytd starts at Jan 1 UTC of the current year', () => {
    const w = resolveRange({ range: 'ytd' }, NOW)
    expect(w.currentStart).toBe('2026-01-01T00:00:00.000Z')
    expect(w.prevStart).not.toBeNull()
  })

  it('all starts at epoch and has no previous window', () => {
    const w = resolveRange({ range: 'all' }, NOW)
    expect(w.currentStart).toBe(new Date(0).toISOString())
    expect(w.prevStart).toBeNull()
  })

  it('custom from/to wins over preset and sets an equal-length prev', () => {
    const w = resolveRange({ range: '7d', from: '2026-09-01', to: '2026-09-11' }, NOW)
    expect(w.currentStart).toBe('2026-09-01T00:00:00.000Z')
    expect(w.currentEnd).toBe('2026-09-11T00:00:00.000Z')
    // 10-day window → prevStart is 10 days before currentStart
    expect(w.prevStart).toBe('2026-08-22T00:00:00.000Z')
  })

  it('unknown range falls back to the 30d default', () => {
    const def = resolveRange({ range: '30d' }, NOW)
    expect(resolveRange({ range: 'bogus' }, NOW)).toEqual(def)
    expect(resolveRange({}, NOW)).toEqual(def)
  })

  it('invalid custom dates (unparseable or from > to) fall back to default', () => {
    const def = resolveRange({}, NOW)
    expect(resolveRange({ from: 'not-a-date', to: '2026-09-11' }, NOW)).toEqual(def)
    expect(resolveRange({ from: '2026-09-11', to: '2026-09-01' }, NOW)).toEqual(def)
  })
})

describe('sumWindows (spec §107)', () => {
  const window: DateWindow = {
    currentStart: '2026-10-01T00:00:00.000Z',
    currentEnd: '2026-10-10T00:00:00.000Z',
    prevStart: '2026-09-22T00:00:00.000Z',
  }
  const rows = [
    { day: '2026-09-25T00:00:00.000Z', v: 5 }, // previous window
    { day: '2026-10-02T00:00:00.000Z', v: 10 }, // current window
    { day: '2026-10-05T00:00:00.000Z', v: 3 }, // current window
    { day: '2026-08-01T00:00:00.000Z', v: 99 }, // outside both
  ]

  it('splits rows into current and previous totals', () => {
    const r = sumWindows(rows, window, (x) => x.day, (x) => x.v)
    expect(r.current).toBe(13)
    expect(r.previous).toBe(5)
  })

  it('previous is null when the window has no prior period', () => {
    const r = sumWindows(rows, { ...window, prevStart: null }, (x) => x.day, (x) => x.v)
    expect(r.current).toBe(13)
    expect(r.previous).toBeNull()
  })

  it('empty rows yield zero current and a zero (not null) previous when a prev window exists', () => {
    const r = sumWindows([], window, (x: { day: string; v: number }) => x.day, (x) => x.v)
    expect(r).toEqual({ current: 0, previous: 0 })
  })

  it('ignores rows with unparseable days', () => {
    const r = sumWindows([{ day: 'nope', v: 7 }], window, (x) => x.day, (x) => x.v)
    expect(r).toEqual({ current: 0, previous: 0 })
  })
})

describe('winRate (spec §106)', () => {
  it('computes won / (won + lost)', () => {
    expect(winRate(3, 1)).toBe(0.75)
  })
  it('guards a zero denominator', () => {
    expect(winRate(0, 0)).toBe(0)
  })
})

describe('conversionRate (spec §106)', () => {
  it('computes leadsWithDeal / leads', () => {
    expect(conversionRate(10, 4)).toBe(0.4)
  })
  it('guards a zero denominator', () => {
    expect(conversionRate(0, 0)).toBe(0)
  })
})
