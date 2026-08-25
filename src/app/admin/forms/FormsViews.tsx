'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import ViewSwitcher from '@/features/views/ViewSwitcher'
import FilterBar from '@/features/views/FilterBar'
import TableView from '@/features/views/TableView'
import ListView from '@/features/views/ListView'
import { useViewMode } from '@/features/views/useViewMode'
import type { CardDef, ColumnDef, FilterDef, ViewMode } from '@/features/views/types'
import CopyLinkButton from '@/features/forms/CopyLinkButton'
import type { FormListItem } from '@/features/forms/queries'

/**
 * Client view host for the Forms list (plan Task 4.2). Owns the view-mode
 * switch (Table / List) and renders the shared framework components against a
 * Forms-specific config. The server page fetches the filtered rows via
 * `listFormsFiltered`; search + status + product filters live in the URL so a
 * view switch preserves them and links are shareable. Published forms carry a
 * copy-link action.
 */

const MODES: ViewMode[] = ['table', 'list']

function StatusChip({ status }: { status: string }) {
  const published = status === 'published'
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full bg-chip-bg px-2.5 py-1 text-xs font-medium',
        published ? 'text-green' : 'text-dim',
      ].join(' ')}
    >
      <span
        aria-hidden
        className={[
          'h-1.5 w-1.5 rounded-full',
          published ? 'bg-green' : 'bg-faint',
        ].join(' ')}
      />
      {published ? 'Published' : 'Draft'}
    </span>
  )
}

export default function FormsViews({
  forms,
  pagination,
  products,
  appUrl,
  filterValues,
}: {
  forms: FormListItem[]
  /** Page footer state for Table/List (total across all pages). */
  pagination: { total: number; page: number; pageSize: number }
  products: { id: string; name: string }[]
  appUrl: string
  filterValues: Record<string, string>
}) {
  const [mode, setMode] = useViewMode('forms', MODES)

  const filters = useMemo<FilterDef[]>(
    () => [
      { key: 'q', label: 'Search', type: 'search' },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        options: [
          { label: 'Published', value: 'published' },
          { label: 'Draft', value: 'draft' },
        ],
      },
      {
        key: 'productId',
        label: 'Product',
        type: 'select',
        options: products.map((p) => ({ label: p.name, value: p.id })),
      },
    ],
    [products]
  )

  const columns = useMemo<ColumnDef<FormListItem>[]>(
    () => [
      {
        key: 'name',
        header: 'Name',
        render: (f) => (
          <>
            {f.name}
            <div className="mt-0.5 font-mono text-xs text-dim">/f/{f.slug}</div>
          </>
        ),
      },
      {
        key: 'product',
        header: 'Product',
        render: (f) => f.product?.name ?? '—',
      },
      {
        key: 'status',
        header: 'Status',
        render: (f) => <StatusChip status={f.status ?? 'draft'} />,
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: (f) => (
          <div className="flex items-center justify-end gap-3">
            {f.status === 'published' ? (
              <CopyLinkButton url={`${appUrl}/f/${f.slug}`} />
            ) : null}
            <Link
              href={`/admin/forms/${f.id}`}
              className="text-sm font-medium text-accent transition-opacity hover:opacity-80"
            >
              Edit
            </Link>
          </div>
        ),
      },
    ],
    [appUrl]
  )

  const card = useMemo<CardDef<FormListItem>>(
    () => ({
      title: (f) => f.name,
      subtitle: (f) => `/f/${f.slug}`,
      href: (f) => `/admin/forms/${f.id}`,
      meta: (f) => [
        f.status === 'published'
          ? { label: 'Published', tone: 'green' as const }
          : { label: 'Draft', tone: 'dim' as const },
        ...(f.product?.name
          ? [{ label: f.product.name, tone: 'dim' as const }]
          : []),
      ],
    }),
    []
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <ViewSwitcher modes={MODES} value={mode} onChange={setMode} />
      </div>

      <FilterBar filters={filters} values={filterValues} />

      {mode === 'table' ? (
        <TableView
          columns={columns}
          rows={forms}
          rowKey={(f) => f.id}
          href={(f) => `/admin/forms/${f.id}`}
          emptyTitle="No forms found"
          emptyHint="Adjust the filters or create your first enrollment form."
          pagination={pagination}
        />
      ) : (
        <ListView
          card={card}
          rows={forms}
          rowKey={(f) => f.id}
          emptyTitle="No forms found"
          emptyHint="Adjust the filters or create your first enrollment form."
          pagination={pagination}
        />
      )}
    </div>
  )
}
