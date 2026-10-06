import { redirect } from 'next/navigation'
import { getCurrentUserWithRole } from '@/features/rbac/permissions'
import { resolveRange } from '@/features/dashboard/range'
import {
  getActivityMetrics,
  getLeadsMetrics,
  getPipelineMetrics,
  getRevenueMetrics,
} from '@/features/dashboard/queries'
import DashboardViews from './DashboardViews'

/**
 * Admin analytics dashboard (design spec §27). Server component gated by the
 * existing `/admin` auth only — every authenticated admin may view it, so there
 * is no module-permission guard (unlike the other sections). Reads the date
 * range from `?range=` or `?from=&to=`, resolves the window, loads every
 * panel's aggregates in parallel, and hands the plain shapes to the client
 * {@link DashboardViews}. No Supabase client crosses the boundary.
 */
export const dynamic = 'force-dynamic'

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await getCurrentUserWithRole()
  if (!ctx) redirect('/admin/login')

  const sp = await searchParams
  const window = resolveRange({
    range: first(sp.range),
    from: first(sp.from),
    to: first(sp.to),
  })

  const [revenue, pipeline, leads, activity] = await Promise.all([
    getRevenueMetrics(window),
    getPipelineMetrics(window),
    getLeadsMetrics(window),
    getActivityMetrics(window),
  ])

  return (
    <DashboardViews
      revenue={revenue}
      pipeline={pipeline}
      leads={leads}
      activity={activity}
    />
  )
}
