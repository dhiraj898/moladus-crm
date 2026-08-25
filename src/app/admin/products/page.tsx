import Link from 'next/link'
import { listProductsPaged, type ProductFilters } from '@/features/records/queries'
import { clampPageSize } from '@/features/views/paginationMath'
import { fetchPagedClamped } from '@/features/views/fetchPagedClamped'
import ProductsViews from './ProductsViews'

/**
 * Product master list (spec §4; plan Task 4.2). Server component: loads the
 * filtered product set (name/code search + active) through the service-role
 * client, then hands it to the client {@link ProductsViews} which owns the
 * Table / List switch. All filtering runs server-side; filters live in the URL
 * so a view switch preserves them and links are shareable.
 */
export const dynamic = 'force-dynamic'

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams

  const filters: ProductFilters = {
    q: first(sp.q),
    active: first(sp.active),
  }

  // Table/List pagination — URL is the source of truth (default 25/page); an
  // out-of-range `?page` is corrected to the last page by `fetchPagedClamped`.
  const pageSize = clampPageSize(first(sp.pageSize))
  const {
    rows: products,
    total,
    page,
  } = await fetchPagedClamped(first(sp.page), pageSize, (window) =>
    listProductsPaged(filters, window)
  )

  const filterValues: Record<string, string> = {
    q: filters.q ?? '',
    active: filters.active ?? '',
  }

  return (
    <div className="mx-auto max-w-[960px]">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-[-0.02em]">
            Products
          </h1>
          <p className="mt-1 text-sm text-dim">
            The catalogue of products that forms can be linked to.
          </p>
        </div>
        <Link
          href="/admin/products/new"
          className="rounded-[8px] bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          New product
        </Link>
      </div>

      <ProductsViews
        products={products}
        pagination={{ total, page, pageSize }}
        filterValues={filterValues}
      />
    </div>
  )
}
