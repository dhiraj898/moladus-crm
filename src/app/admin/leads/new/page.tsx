import Link from 'next/link'
import { listProducts } from '@/features/products/actions'
import LeadForm from '../LeadForm'

/**
 * Manually create a lead (spec §6). Loads active products for the optional
 * product link and wires LeadForm to `createLead`.
 */
export const dynamic = 'force-dynamic'

export default async function NewLeadPage() {
  const products = await listProducts()
  const activeProducts = products.filter((p) => p.active !== false)

  return (
    <div className="mx-auto max-w-[960px]">
      <div className="mb-8">
        <Link
          href="/admin/leads"
          className="text-sm font-medium text-dim transition-colors hover:text-text"
        >
          ← Leads
        </Link>
        <h1 className="mt-3 text-2xl font-extrabold tracking-[-0.02em]">
          New lead
        </h1>
        <p className="mt-1 text-sm text-dim">
          Hand-enter a lead that did not arrive through a form.
        </p>
      </div>
      <LeadForm mode="create" products={activeProducts} />
    </div>
  )
}
