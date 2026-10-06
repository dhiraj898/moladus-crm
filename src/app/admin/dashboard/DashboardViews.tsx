'use client'

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  AreaChart,
  BarChart,
  BarList,
  DonutChart,
  LineChart,
} from '@tremor/react'
import type {
  Activity,
  ActivityType,
  PipelineByStageRow,
  StageVelocityRow,
  StaleDealRow,
} from '@/lib/supabase/types'
import type { RangePreset, WindowTotals } from '@/features/dashboard/range'

/**
 * Client render host for the admin dashboard (design spec §29, §70). Receives
 * only plain, serializable aggregates (no Supabase client crosses the boundary)
 * and owns every Tremor component. The date-range control is URL-driven: preset
 * buttons write `?range=`, the custom pickers write `?from=&to=`; the server page
 * re-resolves the window and refetches. All panels are empty-safe.
 */

// --- Prop shapes (mirror features/dashboard/queries.ts; kept local so no
// server-only module is imported into this client component). ---

export interface RevenueProps {
  grossBooked: WindowTotals
  paid: WindowTotals
  pending: WindowTotals
  gstPaid: number
  series: { day: string; paid: number; pending: number }[]
  byProduct: { product_name: string; total_amount: number }[]
}

export interface PipelineProps {
  byStage: PipelineByStageRow[]
  velocity: StageVelocityRow[]
  winRate: number
}

export interface LeadsProps {
  newLeads: WindowTotals
  perDay: { day: string; count: number }[]
  bySource: { source: string; count: number }[]
  byForm: { form_name: string; count: number }[]
  conversionRate: number
}

export interface ActivityProps {
  recent: Activity[]
  staleDeals: StaleDealRow[]
  notificationsSent: number
}

export interface DashboardViewsProps {
  revenue: RevenueProps
  pipeline: PipelineProps
  leads: LeadsProps
  activity: ActivityProps
}

// --- Formatters ---

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})
const count = new Intl.NumberFormat('en-IN')

const formatINR = (n: number) => inr.format(n)
const formatCount = (n: number) => count.format(n)
const formatPct = (x: number) => `${(x * 100).toFixed(1)}%`
/** Daily axis tick: "6 Oct". */
const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

const ACTIVITY_LABEL: Record<ActivityType, string> = {
  note: 'Note',
  stage_change: 'Stage change',
  created: 'Created',
  edited: 'Edited',
  payment: 'Payment',
  notification: 'Notification',
}

// --- Date-range control ---

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'All' },
]

/** YYYY-MM-DD for `<input type="date">` from a stored ISO/date string. */
function toDateInput(v: string | null): string {
  if (!v) return ''
  const t = Date.parse(v)
  return Number.isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10)
}

function RangeControl() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const from = params.get('from')
  const to = params.get('to')
  const hasCustom = Boolean(from && to)
  // Default preset is 30d when neither a preset nor a full custom range is set.
  const activePreset = hasCustom ? null : (params.get('range') ?? '30d')

  const push = useCallback(
    (next: URLSearchParams) => {
      const qs = next.toString()
      router.push(qs ? `${pathname}?${qs}` : pathname)
    },
    [router, pathname]
  )

  const selectPreset = (value: RangePreset) => {
    push(new URLSearchParams({ range: value }))
  }

  const setCustom = (key: 'from' | 'to', value: string) => {
    const next = new URLSearchParams()
    const other = key === 'from' ? to : from
    if (value) next.set(key, value)
    if (other) next.set(key === 'from' ? 'to' : 'from', other)
    push(next)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1 rounded-md border border-line bg-surface p-1">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => selectPreset(p.value)}
            aria-pressed={activePreset === p.value}
            className={`rounded px-2.5 py-1 text-sm transition-colors ${
              activePreset === p.value
                ? 'bg-accent text-white'
                : 'text-dim hover:text-text'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-sm text-dim">
        <input
          type="date"
          aria-label="From date"
          value={toDateInput(from)}
          max={toDateInput(to) || undefined}
          onChange={(e) => setCustom('from', e.target.value)}
          className="rounded-md border border-line bg-surface px-2 py-1 text-text"
        />
        <span aria-hidden>–</span>
        <input
          type="date"
          aria-label="To date"
          value={toDateInput(to)}
          min={toDateInput(from) || undefined}
          onChange={(e) => setCustom('to', e.target.value)}
          className="rounded-md border border-line bg-surface px-2 py-1 text-text"
        />
      </div>
    </div>
  )
}

// --- Small presentational primitives (design tokens, no Tremor chrome) ---

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{children}</div>
    </section>
  )
}

function Card({
  title,
  className = '',
  children,
}: {
  title?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`rounded-lg border border-line bg-surface p-4 ${className}`}>
      {title ? (
        <h3 className="mb-3 text-sm font-medium text-dim">{title}</h3>
      ) : null}
      {children}
    </div>
  )
}

function DeltaBadge({ totals }: { totals: WindowTotals }) {
  if (totals.previous == null) return null // `all` range: no prior window
  if (totals.previous === 0) {
    return totals.current > 0 ? (
      <span className="text-xs font-medium text-green">new</span>
    ) : null
  }
  const pct = (totals.current - totals.previous) / totals.previous
  const up = pct >= 0
  return (
    <span className={`text-xs font-medium ${up ? 'text-green' : 'text-red'}`}>
      {up ? '▲' : '▼'} {formatPct(Math.abs(pct))}
    </span>
  )
}

function Kpi({
  label,
  value,
  totals,
}: {
  label: string
  value: string
  totals?: WindowTotals
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="text-sm text-dim">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-text">{value}</span>
        {totals ? <DeltaBadge totals={totals} /> : null}
      </div>
    </div>
  )
}

function Empty({ label = 'No data for this range' }: { label?: string }) {
  return (
    <div className="flex h-44 items-center justify-center text-sm text-faint">{label}</div>
  )
}

// --- Panels ---

function RevenuePanel({ revenue }: { revenue: RevenueProps }) {
  return (
    <Panel title="Revenue">
      <Kpi label="Gross booked" value={formatINR(revenue.grossBooked.current)} totals={revenue.grossBooked} />
      <Kpi label="Paid" value={formatINR(revenue.paid.current)} totals={revenue.paid} />
      <Kpi label="Pending" value={formatINR(revenue.pending.current)} totals={revenue.pending} />
      <Kpi label="GST (paid)" value={formatINR(revenue.gstPaid)} />
      <Card title="Paid vs pending over time" className="lg:col-span-2">
        {revenue.series.length ? (
          <AreaChart
            className="h-72"
            data={revenue.series}
            index="day"
            categories={['paid', 'pending']}
            colors={['orange', 'amber']}
            stack
            showAnimation={false}
            valueFormatter={formatINR}
            startEndOnly
            yAxisWidth={72}
          />
        ) : (
          <Empty />
        )}
      </Card>
      <Card title="Revenue by product" className="lg:col-span-2">
        {revenue.byProduct.length ? (
          <BarList
            color="orange"
            data={revenue.byProduct.map((p) => ({ name: p.product_name, value: p.total_amount }))}
            valueFormatter={formatINR}
          />
        ) : (
          <Empty />
        )}
      </Card>
    </Panel>
  )
}

function PipelinePanel({ pipeline }: { pipeline: PipelineProps }) {
  return (
    <Panel title="Pipeline">
      <Kpi label="Win rate" value={formatPct(pipeline.winRate)} />
      <Card title="Deals by stage (count)">
        {pipeline.byStage.length ? (
          <BarChart
            className="h-72"
            data={pipeline.byStage}
            index="stage"
            categories={['count']}
            colors={['orange']}
            showAnimation={false}
            showLegend={false}
            valueFormatter={formatCount}
          />
        ) : (
          <Empty />
        )}
      </Card>
      <Card title="Booked value by stage">
        {pipeline.byStage.length ? (
          <BarChart
            className="h-72"
            data={pipeline.byStage}
            index="stage"
            categories={['total_amount']}
            colors={['amber']}
            showAnimation={false}
            showLegend={false}
            valueFormatter={formatINR}
            yAxisWidth={72}
          />
        ) : (
          <Empty />
        )}
      </Card>
      <Card title="Stage velocity (avg days in stage)" className="lg:col-span-2">
        {pipeline.velocity.length ? (
          <BarChart
            className="h-72"
            data={pipeline.velocity}
            index="stage"
            categories={['avg_days_in_stage']}
            colors={['blue']}
            showAnimation={false}
            showLegend={false}
            valueFormatter={(n) => `${n.toFixed(1)}d`}
          />
        ) : (
          <Empty />
        )}
      </Card>
    </Panel>
  )
}

const DONUT_COLORS = ['orange', 'amber', 'blue', 'cyan', 'violet', 'emerald', 'rose']

function LeadsPanel({ leads }: { leads: LeadsProps }) {
  return (
    <Panel title="Leads / Acquisition">
      <Kpi label="New leads" value={formatCount(leads.newLeads.current)} totals={leads.newLeads} />
      <Kpi label="Conversion rate" value={formatPct(leads.conversionRate)} />
      <Card title="Leads per day" className="lg:col-span-2">
        {leads.perDay.length ? (
          <LineChart
            className="h-72"
            data={leads.perDay}
            index="day"
            categories={['count']}
            colors={['orange']}
            showAnimation={false}
            showLegend={false}
            valueFormatter={formatCount}
            startEndOnly
          />
        ) : (
          <Empty />
        )}
      </Card>
      <Card title="Leads by source">
        {leads.bySource.length ? (
          <DonutChart
            className="h-72"
            data={leads.bySource}
            index="source"
            category="count"
            colors={DONUT_COLORS}
            showAnimation={false}
            valueFormatter={formatCount}
          />
        ) : (
          <Empty />
        )}
      </Card>
      <Card title="Leads by form">
        {leads.byForm.length ? (
          <BarList
            color="orange"
            data={leads.byForm.map((f) => ({ name: f.form_name, value: f.count }))}
            valueFormatter={formatCount}
          />
        ) : (
          <Empty />
        )}
      </Card>
    </Panel>
  )
}

function ActivityPanel({ activity }: { activity: ActivityProps }) {
  return (
    <Panel title="Activity / Ops">
      <Kpi label="Notifications sent" value={formatCount(activity.notificationsSent)} />
      <Card title="Recent activity">
        {activity.recent.length ? (
          <ul className="divide-y divide-line">
            {activity.recent.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <span className="text-xs font-medium uppercase tracking-wide text-accent">
                    {ACTIVITY_LABEL[a.type]}
                  </span>
                  <p className="truncate text-sm text-text">
                    {a.body ?? `${a.entity_type} ${a.type}`}
                  </p>
                </div>
                <time className="shrink-0 whitespace-nowrap text-xs text-faint">
                  {formatDateTime(a.created_at)}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <Empty label="No recent activity" />
        )}
      </Card>
      <Card title="Stale deals (>14 days in stage)" className="lg:col-span-2">
        {activity.staleDeals.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-dim">
                  <th className="py-2 pr-4 font-medium">Deal</th>
                  <th className="py-2 pr-4 font-medium">Stage</th>
                  <th className="py-2 pr-4 text-right font-medium">Value</th>
                  <th className="py-2 pr-4 font-medium">Entered</th>
                  <th className="py-2 text-right font-medium">Days stale</th>
                </tr>
              </thead>
              <tbody>
                {activity.staleDeals.map((d) => (
                  <tr key={d.deal_id} className="border-b border-line/50">
                    <td className="py-2 pr-4 font-mono text-xs text-dim">{d.deal_id.slice(0, 8)}</td>
                    <td className="py-2 pr-4 text-text">{d.stage}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-text">
                      {formatINR(d.total_amount)}
                    </td>
                    <td className="py-2 pr-4 text-dim">{formatDay(d.stage_entered_at)}</td>
                    <td className="py-2 text-right tabular-nums text-amber">{d.days_stale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty label="No stale deals" />
        )}
      </Card>
    </Panel>
  )
}

export default function DashboardViews({ revenue, pipeline, leads, activity }: DashboardViewsProps) {
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-text">Dashboard</h1>
        <RangeControl />
      </div>
      <RevenuePanel revenue={revenue} />
      <PipelinePanel pipeline={pipeline} />
      <LeadsPanel leads={leads} />
      <ActivityPanel activity={activity} />
    </div>
  )
}
