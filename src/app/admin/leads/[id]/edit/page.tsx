import Link from 'next/link'
import { notFound } from 'next/navigation'
import { listProducts } from '@/features/products/actions'
import { getLeadDetail } from '@/features/records/queries'
import { requireModuleView } from '@/features/rbac/guard'
import LeadForm from '../../LeadForm'

/**
 * Edit an existing lead (spec §6). Loads the lead + active products (keeping the
 * currently-linked product even if now inactive) and wires LeadForm to
 * `updateLead`. 404s on a missing or malformed lead id.
 */
export const dynamic = 'force-dynamic'

export default async function EditLeadPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const ctx = await requireModuleView('leads')
  const { id } = await params
  const detail = await getLeadDetail(id, ctx)
  if (!detail) notFound()

  const products = await listProducts()
  const activeProducts = products.filter(
    (p) => p.active !== false || p.id === detail.lead.product_id
  )

  return (
    <div className="mx-auto max-w-[960px]">
      <div className="mb-8">
        <Link
          href={`/admin/leads/${id}`}
          className="text-sm font-medium text-dim transition-colors hover:text-text"
        >
          ← Lead
        </Link>
        <h1 className="mt-3 text-2xl font-extrabold tracking-[-0.02em]">
          Edit lead
        </h1>
      </div>
      <LeadForm mode="edit" lead={detail.lead} products={activeProducts} />
    </div>
  )
}
