import Link from 'next/link'
import {
  listDealsPaged,
  dealStageCounts,
  loadColumnRows,
  type DealFilters,
  type DealListItem,
} from '@/features/records/queries'
import { listStages } from '@/features/crm/stages/queries'
import { listAssignableUsers } from '@/features/rbac/queries'
import { requireModuleView } from '@/features/rbac/guard'
import { scopeFor } from '@/features/rbac/can'
import { clampPageSize } from '@/features/views/paginationMath'
import { fetchPagedClamped } from '@/features/views/fetchPagedClamped'
import { KANBAN_COLUMN_LIMIT } from '@/features/views/kanbanPaging'
import { UNASSIGNED } from '@/features/views/group'
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
  // `fetchPagedClamped` so it never renders an empty table).
  const pageSize = clampPageSize(first(sp.pageSize))

  // Kanban paging (WS3): grouped per-stage counts + the first page (≤50) of each
  // stage column, all under the same RBAC scope + filters. `stageCounts` drives
  // the board's "N of TOTAL" (declared stages + an `__unassigned` key); each
  // column's first page is fetched via `loadColumnRows`, the same server path the
  // "Load more" action re-enters.
  const [stages, pagedDeals, owners, stageCounts] = await Promise.all([
    listStages(),
    fetchPagedClamped(first(sp.page), pageSize, (window) =>
      listDealsPaged(filters, window, ctx)
    ),
    allScope ? listAssignableUsers() : Promise.resolve([]),
    dealStageCounts(filters, ctx),
  ])

  const page = pagedDeals.page

  // First page per column: every declared stage, plus the Unassigned lane only
  // when it holds rows (matching the board's "appears when non-empty" behavior).
  const boardColumnIds = [
    ...stages.map((s) => s.id),
    ...((stageCounts[UNASSIGNED] ?? 0) > 0 ? [UNASSIGNED] : []),
  ]
  const boardRows: Record<string, DealListItem[]> = {}
  await Promise.all(
    boardColumnIds.map(async (columnId) => {
      const { rows } = await loadColumnRows({
        entity: 'deals',
        columnId,
        offset: 0,
        limit: KANBAN_COLUMN_LIMIT,
        filters,
        ctx,
      })
      boardRows[columnId] = rows
    })
  )

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
        boardRows={boardRows}
        boardTotals={stageCounts}
        pagedDeals={pagedDeals.rows}
        pagination={{ total: pagedDeals.total, page, pageSize }}
        stages={stages.map((s) => ({ id: s.id, name: s.name }))}
        owners={owners.map((u) => ({ id: u.id, label: u.email ?? u.id }))}
        filterValues={filterValues}
      />
    </div>
  )
}
