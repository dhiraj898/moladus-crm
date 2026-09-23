import Link from 'next/link'
import { notFound } from 'next/navigation'
import { listProducts } from '@/features/products/actions'
import {
  getDealTimeline,
  listContacts,
  searchLeads,
} from '@/features/records/queries'
import { getActiveCustomFieldDefs } from '@/features/crm/custom-fields/queries'
import { requireModuleView } from '@/features/rbac/guard'
import DealForm from '../../DealForm'

/**
 * Edit an existing deal (spec §4.2 / §6). Loads the deal + active products,
 * contacts, and leads server-side and wires DealForm to `updateDeal`. 404s on a
 * missing or malformed deal id.
 */
export const dynamic = 'force-dynamic'

export default async function EditDealPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const ctx = await requireModuleView('deals')
  const { id } = await params
  const timeline = await getDealTimeline(id, ctx)
  if (!timeline) notFound()

  const [products, contacts, leads, customFieldDefs] = await Promise.all([
    listProducts(),
    listContacts(''),
    searchLeads({}, undefined, ctx),
    getActiveCustomFieldDefs('deal'),
  ])

  // Keep the current product even if it is now inactive, so the edit form can
  // still show and preserve the existing binding.
  const activeProducts = products.filter(
    (p) => p.active !== false || p.id === timeline.deal.product_id
  )

  return (
    <div className="mx-auto max-w-[960px]">
      <div className="mb-8">
        <Link
          href={`/admin/interest/${id}`}
          className="text-sm font-medium text-dim transition-colors hover:text-text"
        >
          ← Interest
        </Link>
        <h1 className="mt-3 text-2xl font-extrabold tracking-[-0.02em]">
          Edit interest
        </h1>
        <p className="mt-1 text-sm text-dim">
          Changing the product or place of supply recomputes GST.
        </p>
      </div>
      <DealForm
        mode="edit"
        deal={timeline.deal}
        products={activeProducts}
        contacts={contacts.map((c) => ({
          id: c.id,
          name: c.name,
          whatsapp_number: c.whatsapp_number,
        }))}
        leads={leads.map((l) => ({ id: l.id, name: l.name, phone: l.phone }))}
        customFieldDefs={customFieldDefs}
      />
    </div>
  )
}
