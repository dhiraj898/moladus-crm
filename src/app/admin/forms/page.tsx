import Link from 'next/link'
import { listFormsFiltered, type FormFilters } from '@/features/records/queries'
import { listProducts } from '@/features/products/actions'
import FormsViews from './FormsViews'

/**
 * Form list (spec §10 — Forms list; plan Task 4.2). Server component: loads the
 * filtered form set (name/slug search + status + product) with each form's bound
 * product through the service-role client, plus the product option set, then
 * hands everything to the client {@link FormsViews} which owns the Table / List
 * switch. All filtering runs server-side; filters live in the URL so a view
 * switch preserves them and links are shareable.
 */
export const dynamic = 'force-dynamic'

/** Public base URL for form links; empty string keeps links relative. */
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function FormsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams

  const filters: FormFilters = {
    q: first(sp.q),
    status: first(sp.status),
    productId: first(sp.productId),
  }

  const [forms, products] = await Promise.all([
    listFormsFiltered(filters),
    listProducts(),
  ])

  const filterValues: Record<string, string> = {
    q: filters.q ?? '',
    status: filters.status ?? '',
    productId: filters.productId ?? '',
  }

  return (
    <div className="mx-auto max-w-[960px]">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-[-0.02em]">Forms</h1>
          <p className="mt-1 text-sm text-dim">
            Product-linked enrollment forms and their public links.
          </p>
        </div>
        <Link
          href="/admin/forms/new"
          className="rounded-[8px] bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          New form
        </Link>
      </div>

      <FormsViews
        forms={forms}
        products={products.map((p) => ({ id: p.id, name: p.name }))}
        appUrl={APP_URL}
        filterValues={filterValues}
      />
    </div>
  )
}
