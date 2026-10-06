import 'server-only'
import { getServiceClient } from '@/lib/supabase/server'
import type {
  Activity,
  LeadConversionRow,
  LeadsByFormRow,
  LeadsBySourceRow,
  LeadsDailyRow,
  PipelineByStageRow,
  RevenueByProductRow,
  RevenueDailyRow,
  StageVelocityRow,
  StaleDealRow,
} from '@/lib/supabase/types'
import {
  conversionRate,
  sumWindows,
  winRate,
  type DateWindow,
  type WindowTotals,
} from './range'

/**
 * Server-only data loaders for the admin dashboard (design spec §28). One
 * exported function per panel/metric group. Each takes a resolved {@link DateWindow}
 * and returns plain, serializable, empty-safe shapes (`[]` / `0`) so a sparse or
 * future-dated range renders empty states rather than crashing.
 *
 * Daily views are pulled once over the span `[prevStart → currentEnd]` and
 * windowed in JS (see {@link sumWindows}); snapshot views (pipeline, velocity,
 * stale deals) are not date-filtered.
 */

/** Days a deal must sit in an open stage before it counts as stale (spec §22). */
const STALE_DAYS = 14

/** Most-recent activity feed length (spec §91). */
const RECENT_ACTIVITY_LIMIT = 15

/** Lower bound for a daily-view pull: the previous window's start, or current when none. */
function spanStart(window: DateWindow): string {
  return window.prevStart ?? window.currentStart
}

function inCurrent(day: string, window: DateWindow): boolean {
  const t = Date.parse(day)
  return t >= Date.parse(window.currentStart) && t <= Date.parse(window.currentEnd)
}

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------

export interface RevenueSeriesPoint {
  day: string
  paid: number
  pending: number
}

export interface RevenueMetrics {
  grossBooked: WindowTotals
  paid: WindowTotals
  pending: WindowTotals
  gstPaid: number
  series: RevenueSeriesPoint[]
  byProduct: { product_name: string; total_amount: number }[]
}

export async function getRevenueMetrics(window: DateWindow): Promise<RevenueMetrics> {
  const sb = getServiceClient()
  const [daily, products] = await Promise.all([
    sb
      .from('v_revenue_daily')
      .select('*')
      .gte('day', spanStart(window))
      .lte('day', window.currentEnd),
    sb
      .from('v_revenue_by_product')
      .select('*')
      .gte('day', window.currentStart)
      .lte('day', window.currentEnd),
  ])

  const rows = (daily.data ?? []) as RevenueDailyRow[]
  const paidRows = rows.filter((r) => r.bucket === 'paid')
  const pendingRows = rows.filter((r) => r.bucket === 'pending')

  const paid = sumWindows(paidRows, window, (r) => r.day, (r) => r.total_amount)
  const pending = sumWindows(pendingRows, window, (r) => r.day, (r) => r.total_amount)
  const grossBooked: WindowTotals = {
    current: paid.current + pending.current,
    previous:
      paid.previous == null && pending.previous == null
        ? null
        : (paid.previous ?? 0) + (pending.previous ?? 0),
  }

  const gstPaid = sumWindows(paidRows, window, (r) => r.day, (r) => r.gst).current

  // Current-window stacked series, one point per day.
  const byDay = new Map<string, RevenueSeriesPoint>()
  for (const r of rows) {
    if (!inCurrent(r.day, window)) continue
    const point = byDay.get(r.day) ?? { day: r.day, paid: 0, pending: 0 }
    point[r.bucket] += r.total_amount
    byDay.set(r.day, point)
  }
  const series = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))

  // Revenue by product (gross: both buckets), current window, descending.
  const productRows = (products.data ?? []) as RevenueByProductRow[]
  const byProductMap = new Map<string, number>()
  for (const r of productRows) {
    byProductMap.set(r.product_name, (byProductMap.get(r.product_name) ?? 0) + r.total_amount)
  }
  const byProduct = [...byProductMap.entries()]
    .map(([product_name, total_amount]) => ({ product_name, total_amount }))
    .sort((a, b) => b.total_amount - a.total_amount)

  return { grossBooked, paid, pending, gstPaid, series, byProduct }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export interface PipelineMetrics {
  byStage: PipelineByStageRow[]
  velocity: StageVelocityRow[]
  winRate: number
}

export async function getPipelineMetrics(_window: DateWindow): Promise<PipelineMetrics> {
  const sb = getServiceClient()
  const [stages, velocity] = await Promise.all([
    sb.from('v_pipeline_by_stage').select('*').order('display_order', { ascending: true }),
    sb.from('v_stage_velocity').select('*'),
  ])

  const byStage = (stages.data ?? []) as PipelineByStageRow[]
  const won = byStage.filter((s) => s.type === 'won').reduce((n, s) => n + s.count, 0)
  const lost = byStage.filter((s) => s.type === 'lost').reduce((n, s) => n + s.count, 0)

  return {
    byStage,
    velocity: (velocity.data ?? []) as StageVelocityRow[],
    winRate: winRate(won, lost),
  }
}

// ---------------------------------------------------------------------------
// Leads / Acquisition
// ---------------------------------------------------------------------------

export interface LeadsMetrics {
  newLeads: WindowTotals
  perDay: { day: string; count: number }[]
  bySource: { source: string; count: number }[]
  byForm: { form_name: string; count: number }[]
  conversionRate: number
}

export async function getLeadsMetrics(window: DateWindow): Promise<LeadsMetrics> {
  const sb = getServiceClient()
  const [daily, source, form, conversion] = await Promise.all([
    sb.from('v_leads_daily').select('*').gte('day', spanStart(window)).lte('day', window.currentEnd),
    sb
      .from('v_leads_by_source')
      .select('*')
      .gte('day', window.currentStart)
      .lte('day', window.currentEnd),
    sb
      .from('v_leads_by_form')
      .select('*')
      .gte('day', window.currentStart)
      .lte('day', window.currentEnd),
    sb
      .from('v_lead_conversion')
      .select('*')
      .gte('day', window.currentStart)
      .lte('day', window.currentEnd),
  ])

  const dailyRows = (daily.data ?? []) as LeadsDailyRow[]
  const newLeads = sumWindows(dailyRows, window, (r) => r.day, (r) => r.count)
  const perDay = dailyRows
    .filter((r) => inCurrent(r.day, window))
    .map((r) => ({ day: r.day, count: r.count }))
    .sort((a, b) => a.day.localeCompare(b.day))

  const bySource = aggregateCounts(
    (source.data ?? []) as LeadsBySourceRow[],
    (r) => r.source,
    (r) => r.count
  ).map(([name, count]) => ({ source: name, count }))

  const byForm = aggregateCounts(
    (form.data ?? []) as LeadsByFormRow[],
    (r) => r.form_name,
    (r) => r.count
  ).map(([name, count]) => ({ form_name: name, count }))

  const conv = (conversion.data ?? []) as LeadConversionRow[]
  const leads = conv.reduce((n, r) => n + r.leads, 0)
  const withDeal = conv.reduce((n, r) => n + r.leads_with_deal, 0)

  return { newLeads, perDay, bySource, byForm, conversionRate: conversionRate(leads, withDeal) }
}

/** Sum a count per dimension key, returned as [key, count] pairs descending. */
function aggregateCounts<T>(
  rows: readonly T[],
  getKey: (row: T) => string,
  getCount: (row: T) => number
): [string, number][] {
  const map = new Map<string, number>()
  for (const r of rows) map.set(getKey(r), (map.get(getKey(r)) ?? 0) + getCount(r))
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}

// ---------------------------------------------------------------------------
// Activity / Ops
// ---------------------------------------------------------------------------

export interface ActivityMetrics {
  recent: Activity[]
  staleDeals: StaleDealRow[]
  notificationsSent: number
}

export async function getActivityMetrics(window: DateWindow): Promise<ActivityMetrics> {
  const sb = getServiceClient()
  const [recent, stale, notifications] = await Promise.all([
    sb
      .from('activities')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(RECENT_ACTIVITY_LIMIT),
    sb.from('v_stale_deals').select('*').gt('days_stale', STALE_DAYS),
    sb
      .from('notification_log')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'sent')
      .gte('sent_at', window.currentStart)
      .lte('sent_at', window.currentEnd),
  ])

  const staleDeals = ((stale.data ?? []) as StaleDealRow[]).sort(
    (a, b) => b.days_stale - a.days_stale
  )

  return {
    recent: (recent.data ?? []) as Activity[],
    staleDeals,
    notificationsSent: notifications.count ?? 0,
  }
}
