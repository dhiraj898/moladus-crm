'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import ViewSwitcher from '@/features/views/ViewSwitcher'
import FilterBar from '@/features/views/FilterBar'
import TableView from '@/features/views/TableView'
import ListView from '@/features/views/ListView'
import { useViewMode } from '@/features/views/useViewMode'
import type { CardDef, ColumnDef, FilterDef, ViewMode } from '@/features/views/types'
import ActiveToggle from '@/features/products/ActiveToggle'
import type { Product } from '@/lib/supabase/types'

/**
 * Client view host for the Products list (plan Task 4.2). Owns the view-mode
 * switch (Table / List) and renders the shared framework components against a
 * Products-specific config. The server page fetches the filtered rows via
 * `listProductsFiltered`; search + active filters live in the URL so a view
 * switch preserves them and links are shareable. The base-price column keeps
 * `tabular-nums` so money aligns.
 */

const MODES: ViewMode[] = ['table', 'list']

/** Format a base price with its currency (rendered under `tabular-nums`). */
function formatPrice(amount: number, currency: string | null): string {
  const code = currency ?? 'INR'
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${code} ${amount.toFixed(2)}`
  }
}

export default function ProductsViews({
  products,
  filterValues,
}: {
  products: Product[]
  filterValues: Record<string, string>
}) {
  const [mode, setMode] = useViewMode('products', MODES)

  const filters = useMemo<FilterDef[]>(
    () => [
      { key: 'q', label: 'Search', type: 'search' },
      {
        key: 'active',
        label: 'Status',
        type: 'select',
        options: [
          { label: 'Active', value: 'true' },
          { label: 'Inactive', value: 'false' },
        ],
      },
    ],
    []
  )

  const columns = useMemo<ColumnDef<Product>[]>(
    () => [
      { key: 'name', header: 'Name', render: (p) => p.name },
      { key: 'code', header: 'Code', render: (p) => p.code ?? '—' },
      {
        key: 'price',
        header: 'Base price',
        align: 'right',
        render: (p) => (
          <span className="tabular-nums text-text">
            {formatPrice(p.base_price, p.currency)}
          </span>
        ),
      },
      {
        key: 'gst',
        header: 'GST %',
        align: 'right',
        render: (p) => (
          <span className="tabular-nums text-text">
            {p.taxable === false
              ? '—'
              : `${(p.gst_percentage ?? 0).toFixed(2)}%`}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (p) => <ActiveToggle id={p.id} active={p.active ?? false} />,
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: (p) => (
          <Link
            href={`/admin/products/${p.id}`}
            className="text-sm font-medium text-accent transition-opacity hover:opacity-80"
          >
            Edit
          </Link>
        ),
      },
    ],
    []
  )

  const card = useMemo<CardDef<Product>>(
    () => ({
      title: (p) => p.name,
      subtitle: (p) => p.code ?? '—',
      href: (p) => `/admin/products/${p.id}`,
      meta: (p) => [
        { label: formatPrice(p.base_price, p.currency), tone: 'dim' as const },
        p.active
          ? { label: 'Active', tone: 'green' as const }
          : { label: 'Inactive', tone: 'dim' as const },
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
          rows={products}
          rowKey={(p) => p.id}
          href={(p) => `/admin/products/${p.id}`}
          emptyTitle="No products found"
          emptyHint="Adjust the filters or create your first product."
        />
      ) : (
        <ListView
          card={card}
          rows={products}
          rowKey={(p) => p.id}
          emptyTitle="No products found"
          emptyHint="Adjust the filters or create your first product."
        />
      )}
    </div>
  )
}
