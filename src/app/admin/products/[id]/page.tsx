import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getProduct } from '@/features/products/actions'
import ProductForm from '@/features/products/ProductForm'
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

  const customFieldDefs = await getActiveCustomFieldDefs('product')

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
        customFieldDefs={customFieldDefs}
      />
    </div>
  )
}
