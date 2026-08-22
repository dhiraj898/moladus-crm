import Link from 'next/link'
import { listProducts } from '@/features/products/actions'
import { listContacts, searchLeads } from '@/features/records/queries'
import DealForm from '../DealForm'

/**
 * Manually create a deal (spec §4.2 / §6). Loads active products, contacts, and
 * leads server-side and wires DealForm to `createDeal`.
 */
export const dynamic = 'force-dynamic'

export default async function NewDealPage() {
  const [products, contacts, leads] = await Promise.all([
    listProducts(),
    listContacts(''),
    searchLeads({}),
  ])

  const activeProducts = products.filter((p) => p.active !== false)

  return (
    <div className="mx-auto max-w-[960px]">
      <div className="mb-8">
        <Link
          href="/admin/deals"
          className="text-sm font-medium text-dim transition-colors hover:text-text"
        >
          ← Deals
        </Link>
        <h1 className="mt-3 text-2xl font-extrabold tracking-[-0.02em]">
          New deal
        </h1>
        <p className="mt-1 text-sm text-dim">
          Bind a contact and product; GST is computed from the product.
        </p>
      </div>
      <DealForm
        mode="create"
        products={activeProducts}
        contacts={contacts.map((c) => ({
          id: c.id,
          name: c.name,
          whatsapp_number: c.whatsapp_number,
        }))}
        leads={leads.map((l) => ({ id: l.id, name: l.name, phone: l.phone }))}
      />
    </div>
  )
}
