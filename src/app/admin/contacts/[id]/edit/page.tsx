import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getContactDetail, searchLeads } from '@/features/records/queries'
import ContactForm from '../../ContactForm'

/**
 * Edit an existing contact (spec §6). Loads the contact + leads for the optional
 * lead link and wires ContactForm to `updateContact`. 404s on a missing or
 * malformed contact id.
 */
export const dynamic = 'force-dynamic'

export default async function EditContactPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [detail, leads] = await Promise.all([
    getContactDetail(id),
    searchLeads({}),
  ])
  if (!detail) notFound()

  return (
    <div className="mx-auto max-w-[960px]">
      <div className="mb-8">
        <Link
          href={`/admin/contacts/${id}`}
          className="text-sm font-medium text-dim transition-colors hover:text-text"
        >
          ← Contact
        </Link>
        <h1 className="mt-3 text-2xl font-extrabold tracking-[-0.02em]">
          Edit contact
        </h1>
      </div>
      <ContactForm
        mode="edit"
        contact={detail.contact}
        leads={leads.map((l) => ({ id: l.id, name: l.name, phone: l.phone }))}
      />
    </div>
  )
}
