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
import { changeLeadStatus, type LeadStatus } from '@/features/crm/leads/actions'
import { LEAD_STATUSES } from '@/features/crm/leads/schema'
import type { LeadListItem } from '@/features/records/queries'

/**
 * Client view host for the Leads list (plan Task 3.2). Owns the view-mode
 * switch (Kanban / Table / List) and renders the shared framework components
 * against a Leads-specific config. Kanban columns are the canonical
 * {@link LEAD_STATUSES}; dragging a card calls the existing `changeLeadStatus`
 * action (own-scope IDOR-guarded server-side). The server page fetches the
 * RBAC-scoped, filtered rows plus product / form / owner option sets.
 */

const MODES: ViewMode[] = ['kanban', 'table', 'list']

const SORT_OPTIONS = [
  { label: 'Newest first', value: 'created_desc' },
  { label: 'Oldest first', value: 'created_asc' },
  { label: 'Name (A → Z)', value: 'name_asc' },
  { label: 'Name (Z → A)', value: 'name_desc' },
]

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d)
}

export default function LeadsViews({
  leads,
  products,
  forms,
  owners,
  filterValues,
}: {
  leads: LeadListItem[]
  products: { id: string; name: string }[]
  forms: { id: string; name: string }[]
  /** Owner options; empty for own-scope callers (no owner filter shown). */
  owners: { id: string; label: string }[]
  filterValues: Record<string, string>
}) {
  const [mode, setMode] = useViewMode('leads', MODES)

  const filters = useMemo<FilterDef[]>(() => {
    const base: FilterDef[] = [
      { key: 'q', label: 'Search', type: 'search' },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        options: LEAD_STATUSES.map((s) => ({ label: s, value: s })),
      },
      {
        key: 'productId',
        label: 'Product',
        type: 'select',
        options: products.map((p) => ({ label: p.name, value: p.id })),
      },
      {
        key: 'formId',
        label: 'Form',
        type: 'select',
        options: forms.map((f) => ({ label: f.name, value: f.id })),
      },
      { key: 'from', label: 'From', type: 'date' },
      { key: 'to', label: 'To', type: 'date' },
      { key: 'sort', label: 'Sort', type: 'select', options: SORT_OPTIONS },
    ]
    if (owners.length > 0) {
      base.splice(4, 0, {
        key: 'ownerId',
        label: 'Owner',
        type: 'select',
        options: owners.map((o) => ({ label: o.label, value: o.id })),
      })
    }
    return base
  }, [products, forms, owners])

  const columns = useMemo<ColumnDef<LeadListItem>[]>(
    () => [
      { key: 'name', header: 'Name', render: (l) => l.name ?? 'View lead' },
      {
        key: 'contact',
        header: 'Contact',
        render: (l) => l.phone ?? l.email ?? '—',
      },
      {
        key: 'product',
        header: 'Product',
        render: (l) => l.product?.name ?? '—',
      },
      { key: 'status', header: 'Status', render: (l) => l.status ?? 'Not Contacted' },
      {
        key: 'created',
        header: 'Created',
        align: 'right',
        sortable: true,
        render: (l) => formatDate(l.created_at),
      },
    ],
    []
  )

  const card = useMemo<CardDef<LeadListItem>>(
    () => ({
      title: (l) => l.name ?? 'Unnamed lead',
      subtitle: (l) => l.phone ?? l.email ?? '—',
      href: (l) => `/admin/leads/${l.id}`,
      meta: (l) => [
        { label: l.status ?? 'Not Contacted', tone: 'accent' },
        ...(l.product?.name
          ? [{ label: l.product.name, tone: 'dim' as const }]
          : []),
      ],
    }),
    []
  )

  const groupColumns = useMemo<GroupColumn[]>(
    () => LEAD_STATUSES.map((s) => ({ id: s, label: s })),
    []
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
          cards={leads}
          card={card}
          getCardId={(l) => l.id}
          getColumnId={(l) => l.status}
          onMove={(cardId, toColumnId) =>
            changeLeadStatus(cardId, toColumnId as LeadStatus)
          }
        />
      ) : mode === 'table' ? (
        <TableView
          columns={columns}
          rows={leads}
          rowKey={(l) => l.id}
          href={(l) => `/admin/leads/${l.id}`}
          emptyTitle="No leads found"
          emptyHint="Adjust the filters or wait for new submissions to arrive."
        />
      ) : (
        <ListView
          card={card}
          rows={leads}
          rowKey={(l) => l.id}
          emptyTitle="No leads found"
          emptyHint="Adjust the filters or wait for new submissions to arrive."
        />
      )}
    </div>
  )
}
