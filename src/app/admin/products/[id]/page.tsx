import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getProduct, listProducts, deleteProduct } from '@/features/products/actions'
import ProductForm from '@/features/products/ProductForm'
import DeleteButton from '@/components/DeleteButton'
import { getActiveCustomFieldDefs } from '@/features/crm/custom-fields/queries'

/** Edit an existing product (spec §4). Wires ProductForm to `updateProduct`. */
export const dynamic = 'force-dynamic'

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const product = await getProduct(id)

  if (!product) notFound()

  const [customFieldDefs, products] = await Promise.all([
    getActiveCustomFieldDefs('product'),
    listProducts(),
  ])

  return (
    <div className="mx-auto max-w-[960px]">
      <div className="mb-8">
        <Link
          href="/admin/products"
          className="text-sm font-medium text-dim transition-colors hover:text-text"
        >
          ← Products
        </Link>
        <h1 className="mt-3 text-2xl font-extrabold tracking-[-0.02em]">
          {product.name}
        </h1>
        <p className="mt-1 text-sm text-dim">Edit product details.</p>
      </div>
      <ProductForm
        mode="edit"
        product={product}
        products={products}
        customFieldDefs={customFieldDefs}
      />

      <section className="mt-12 border-t border-line pt-8">
        <h2 className="mb-1 text-lg font-bold tracking-[-0.01em]">Danger zone</h2>
        <p className="mb-4 max-w-[640px] text-sm text-dim">
          Permanently delete this product. Blocked if it is still used by a
          form, lead, or order — deactivate it instead.
        </p>
        <DeleteButton
          action={deleteProduct.bind(null, product.id)}
          redirectTo="/admin/products"
          confirm={`Delete "${product.name}"? This cannot be undone.`}
          label="Delete product"
        />
      </section>
    </div>
  )
}
