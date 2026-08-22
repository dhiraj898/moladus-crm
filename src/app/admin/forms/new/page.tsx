import Link from 'next/link'
import { listProducts } from '@/features/products/actions'
import FormMetaForm from '@/features/forms/FormMetaForm'

/**
 * Create a new form (spec §4 / §10). Offers only active products in the picker
 * (one product per form); on create the user is sent to the field builder.
 */
export const dynamic = 'force-dynamic'

export default async function NewFormPage() {
  const products = await listProducts()
  const activeProducts = products.filter((p) => p.active !== false)

  return (
    <div className="mx-auto max-w-[960px]">
      <div className="mb-8">
        <Link
          href="/admin/forms"
          className="text-sm font-medium text-dim transition-colors hover:text-text"
        >
          ← Forms
        </Link>
        <h1 className="mt-3 text-2xl font-extrabold tracking-[-0.02em]">
          New form
        </h1>
        <p className="mt-1 text-sm text-dim">
          Name the form, choose a slug, and link an active product.
        </p>
      </div>

      {activeProducts.length === 0 ? (
        <div className="rounded-[12px] border border-line bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-text">No active products</p>
          <p className="mt-1 text-sm text-dim">
            Create and activate a product before building a form.
          </p>
          <Link
            href="/admin/products/new"
            className="mt-5 inline-block rounded-[8px] bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            New product
          </Link>
        </div>
      ) : (
        <FormMetaForm mode="create" products={activeProducts} />
      )}
    </div>
  )
}
