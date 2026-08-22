import Link from 'next/link'
import { listProducts } from '@/features/products/actions'
import ActiveToggle from '@/features/products/ActiveToggle'

/**
 * Product master list (spec §4). Server component: reads products via the
 * service-role client, renders a design-system table with row borders only
 * and tabular numerals on the numeric columns.
 */
export const dynamic = 'force-dynamic'

/** Format a base price with its currency using tabular numerals downstream. */
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
    // Unknown currency code — fall back to a plain 2dp number with the code.
    return `${code} ${amount.toFixed(2)}`
  }
}

export default async function ProductsPage() {
  const products = await listProducts()

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

      {products.length === 0 ? (
        <div className="rounded-[12px] border border-line bg-surface px-6 py-16 text-center">
          <p className="text-sm font-medium text-text">No products yet</p>
          <p className="mt-1 text-sm text-dim">
            Create your first product to link it to an enrollment form.
          </p>
          <Link
            href="/admin/products/new"
            className="mt-5 inline-block rounded-[8px] bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            New product
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-4 py-3 font-semibold text-dim">Name</th>
                <th className="px-4 py-3 font-semibold text-dim">Code</th>
                <th className="px-4 py-3 text-right font-semibold text-dim">
                  Base price
                </th>
                <th className="px-4 py-3 text-right font-semibold text-dim">
                  GST %
                </th>
                <th className="px-4 py-3 font-semibold text-dim">Status</th>
                <th className="px-4 py-3 text-right font-semibold text-dim">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr
                  key={product.id}
                  className="border-b border-line last:border-b-0"
                >
                  <td className="px-4 py-3 font-medium text-text">
                    {product.name}
                  </td>
                  <td className="px-4 py-3 text-dim">
                    {product.code ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text">
                    {formatPrice(product.base_price, product.currency)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text">
                    {product.taxable === false
                      ? '—'
                      : `${(product.gst_percentage ?? 0).toFixed(2)}%`}
                  </td>
                  <td className="px-4 py-3">
                    <ActiveToggle
                      id={product.id}
                      active={product.active ?? false}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/products/${product.id}`}
                      className="text-sm font-medium text-accent transition-opacity hover:opacity-80"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
