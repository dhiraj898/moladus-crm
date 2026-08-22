import Link from 'next/link'
import ProductForm from '@/features/products/ProductForm'

/** Create a new product (spec §4). Wires ProductForm to `createProduct`. */
export default function NewProductPage() {
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
          New product
        </h1>
      </div>
      <ProductForm mode="create" />
    </div>
  )
}
