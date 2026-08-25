'use client'

import { useMemo } from 'react'
import ViewSwitcher from '@/features/views/ViewSwitcher'
import FilterBar from '@/features/views/FilterBar'
import TableView from '@/features/views/TableView'
import ListView from '@/features/views/ListView'
import KanbanBoard from '@/features/views/KanbanBoard'
import { useViewMode } from '@/features/views/useViewMode'
import type {
  CardDef,
  ColumnDef,
  FilterDef,
  GroupColumn,
  ViewMode,
} from '@/features/views/types'
import { changeDealStage, loadDealColumnRows } from '@/features/crm/deals/actions'
import { formatMoney } from '@/features/form-engine/estimate'
import PaymentStatusChip from '@/features/records/PaymentStatusChip'
import type { DealFilters, DealListItem } from '@/features/records/queries'
import type { PaymentStatus } from '@/lib/supabase/types'

/**
 * Client view host for the Deals list (plan Task 3.1). Owns the view-mode
 * switch (Kanban / Table / List) and renders the shared framework components
 * against a Deals-specific {@link import('@/features/views/types').ListViewConfig}.
 * The server page fetches the RBAC-scoped, filtered rows and the stage +
 * owner option sets; this component only presents them. Kanban drag calls the
 * existing `changeDealStage` action (optimistic move + rollback lives in
 * {@link KanbanBoard}); moving into a stage may fire its on-enter automation,
 * which is intended.
 */

const MODES: ViewMode[] = ['kanban', 'table', 'list']

const PAYMENT_STATUS_OPTIONS: readonly PaymentStatus[] = [
  'pending',
  'link_sent',
  'link_expired',
  'paid',
  'failed',
  'refunded',
]

const SORT_OPTIONS = [
  { label: 'Newest first', value: 'created_desc' },
  { label: 'Oldest first', value: 'created_asc' },
  { label: 'Total (high → low)', value: 'total_desc' },
  { label: 'Total (low → high)', value: 'total_asc' },
]

/** Map a payment status to a card-chip tone. */
function paymentTone(
  status: PaymentStatus | null
): 'green' | 'amber' | 'red' | 'dim' {
  if (status === 'paid') return 'green'
  if (status === 'link_sent') return 'amber'
  if (status === 'failed') return 'red'
  return 'dim'
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d)
}

export default function DealsViews({
  boardRows,
  boardTotals,
  pagedDeals,
  pagination,
  stages,
  owners,
  filterValues,
}: {
  /** Kanban first page per stage id (+ `__unassigned`), drag-to-move + paged. */
  boardRows: Record<string, DealListItem[]>
  /** Total deals per stage id (+ `__unassigned`) for the Kanban "N of TOTAL". */
  boardTotals: Record<string, number>
  /** The current Table/List page window (RBAC-scoped, filtered, paged). */
  pagedDeals: DealListItem[]
  /** Page footer state for Table/List (total across all pages). */
  pagination: { total: number; page: number; pageSize: number }
  stages: { id: string; name: string }[]
  /** Owner options; empty for own-scope callers (no owner filter shown). */
  owners: { id: string; label: string }[]
  filterValues: Record<string, string>
}) {
  const [mode, setMode] = useViewMode('deals', MODES)

  const filters = useMemo<FilterDef[]>(() => {
    const base: FilterDef[] = [
      { key: 'q', label: 'Search', type: 'search' },
      {
        key: 'paymentStatus',
        label: 'Payment',
        type: 'select',
        options: PAYMENT_STATUS_OPTIONS.map((s) => ({
          label: s.replace(/_/g, ' '),
          value: s,
        })),
      },
      {
        key: 'stageId',
        label: 'Stage',
        type: 'select',
        options: stages.map((s) => ({ label: s.name, value: s.id })),
      },
      { key: 'from', label: 'From', type: 'date' },
      { key: 'to', label: 'To', type: 'date' },
      { key: 'sort', label: 'Sort', type: 'select', options: SORT_OPTIONS },
    ]
    if (owners.length > 0) {
      base.splice(3, 0, {
        key: 'ownerId',
        label: 'Owner',
        type: 'select',
        options: owners.map((o) => ({ label: o.label, value: o.id })),
      })
    }
    return base
  }, [stages, owners])

  const columns = useMemo<ColumnDef<DealListItem>[]>(
    () => [
      {
        key: 'contact',
        header: 'Contact',
        render: (d) => d.contact?.name ?? '—',
      },
      {
        key: 'product',
        header: 'Product',
        render: (d) => d.product?.name ?? '—',
      },
      { key: 'stage', header: 'Stage', render: (d) => d.stage_name ?? '—' },
      {
        key: 'total',
        header: 'Total',
        align: 'right',
        sortable: true,
        render: (d) => formatMoney(d.total_amount),
      },
      {
        key: 'payment',
        header: 'Payment',
        render: (d) => <PaymentStatusChip status={d.payment_status} />,
      },
      {
        key: 'created',
        header: 'Created',
        align: 'right',
        sortable: true,
        render: (d) => formatDate(d.created_at),
      },
    ],
    []
  )

  const card = useMemo<CardDef<DealListItem>>(
    () => ({
      title: (d) => d.contact?.name ?? 'Untitled deal',
      subtitle: (d) => d.product?.name ?? '—',
      href: (d) => `/admin/deals/${d.id}`,
      meta: (d) => [
        { label: formatMoney(d.total_amount), tone: 'accent' },
        {
          label: (d.payment_status ?? 'pending').replace(/_/g, ' '),
          tone: paymentTone(d.payment_status),
        },
        ...(d.stage_name ? [{ label: d.stage_name, tone: 'dim' as const }] : []),
      ],
    }),
    []
  )

  const groupColumns = useMemo<GroupColumn[]>(
    () => stages.map((s) => ({ id: s.id, label: s.name })),
    [stages]
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <ViewSwitcher modes={MODES} value={mode} onChange={setMode} />
      </div>

      <FilterBar filters={filters} values={filterValues} />

      {mode === 'kanban' ? (
        <KanbanBoard
          columns={groupColumns}
          initialRows={boardRows}
          totals={boardTotals}
          card={card}
          getCardId={(d) => d.id}
          onMove={(cardId, toColumnId) => changeDealStage(cardId, toColumnId)}
          onLoadMore={async (columnId, offset) => {
            const res = await loadDealColumnRows({
              columnId,
              offset,
              filters: filterValues as DealFilters,
            })
            return res.ok
              ? { ok: true, rows: res.data.rows, total: res.data.total }
              : { ok: false, error: res.error }
          }}
        />
      ) : mode === 'table' ? (
        <TableView
          columns={columns}
          rows={pagedDeals}
          rowKey={(d) => d.id}
          href={(d) => `/admin/deals/${d.id}`}
          emptyTitle="No deals found"
          emptyHint="Adjust the filters or wait for new enrollments to convert."
          pagination={pagination}
        />
      ) : (
        <ListView
          card={card}
          rows={pagedDeals}
          rowKey={(d) => d.id}
          emptyTitle="No deals found"
          emptyHint="Adjust the filters or wait for new enrollments to convert."
          pagination={pagination}
        />
      )}
    </div>
  )
}
