import Link from 'next/link'
import { listDeals, listDealsPaged, type DealFilters } from '@/features/records/queries'
import { listStages } from '@/features/crm/stages/queries'
import { listAssignableUsers } from '@/features/rbac/queries'
import { requireModuleView } from '@/features/rbac/guard'
import { scopeFor } from '@/features/rbac/can'
import { clampPageSize } from '@/features/views/paginationMath'
import { fetchPagedClamped } from '@/features/views/fetchPagedClamped'
import DealsViews from './DealsViews'

/**
 * Deals list (spec §10 — Deals list; plan Task 3.1). Server component: resolves
 * the RBAC ctx, loads the stage pipeline (Kanban columns) + the filtered,
 * scope-respecting deal set, and — for all-scope roles only — the owner options,
 * then hands everything to the client {@link DealsViews} which owns the
 * Kanban / Table / List switch. All filtering + search runs server-side through
 * the service-role client; own-vs-all scope is enforced inside `listDeals`.
 */
export const dynamic = 'force-dynamic'

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireModuleView('deals')
  const sp = await searchParams

  const filters: DealFilters = {
    q: first(sp.q),
    paymentStatus: first(sp.paymentStatus),
    stageId: first(sp.stageId),
    ownerId: first(sp.ownerId),
    from: first(sp.from),
    to: first(sp.to),
    sort: first(sp.sort),
  }

  const allScope = scopeFor(ctx.permissions, 'deals') === 'all'

  // Table/List pagination — URL is the source of truth. `pageSize` is clamped to
  // the allowed set (default 25); `page` is clamped to `[1, pageCount]` after we
  // know the total (an out-of-range `?page` is corrected to the last page by
  // `fetchPagedClamped` so it never renders an empty table). Kanban keeps its own
  // full fetch (WS3 replaces it with per-column counts + load-more), so both
  // queries run here.
  const pageSize = clampPageSize(first(sp.pageSize))

  const [stages, deals, pagedDeals, owners] = await Promise.all([
    listStages(),
    listDeals(filters, undefined, ctx),
    fetchPagedClamped(first(sp.page), pageSize, (window) =>
      listDealsPaged(filters, window, ctx)
    ),
    allScope ? listAssignableUsers() : Promise.resolve([]),
  ])

  const page = pagedDeals.page

  // Seed the FilterBar controls from the current URL params (design: filters
  // live in the URL so a view switch preserves them and links are shareable).
  const filterValues: Record<string, string> = {
    q: filters.q ?? '',
    paymentStatus: filters.paymentStatus ?? '',
    stageId: filters.stageId ?? '',
    ownerId: filters.ownerId ?? '',
    from: filters.from ?? '',
    to: filters.to ?? '',
    sort: filters.sort ?? '',
  }

  const exportParams = new URLSearchParams({ type: 'deals' })
  if (filters.paymentStatus)
    exportParams.set('paymentStatus', filters.paymentStatus)
  if (filters.from) exportParams.set('from', filters.from)
  if (filters.to) exportParams.set('to', filters.to)

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-[-0.02em]">Deals</h1>
          <p className="mt-1 text-sm text-dim">
            Enrollment deals and their payment state.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/admin/export?${exportParams.toString()}`}
            className="rounded-[8px] border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-text transition-colors hover:bg-surface2"
          >
            Export CSV
          </a>
          <Link
            href="/admin/deals/new"
            className="rounded-[8px] bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            New deal
          </Link>
        </div>
      </div>

      <DealsViews
        deals={deals}
        pagedDeals={pagedDeals.rows}
        pagination={{ total: pagedDeals.total, page, pageSize }}
        stages={stages.map((s) => ({ id: s.id, name: s.name }))}
        owners={owners.map((u) => ({ id: u.id, label: u.email ?? u.id }))}
        filterValues={filterValues}
      />
    </div>
  )
}
