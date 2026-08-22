import Link from 'next/link'
import { searchLeads } from '@/features/records/queries'
import ContactForm from '../ContactForm'

/**
 * Manually create a contact (spec §6). Loads leads for the optional lead link
 * and wires ContactForm to `createContact`.
 */
export const dynamic = 'force-dynamic'

export default async function NewContactPage() {
  const leads = await searchLeads({})

  return (
    <div className="mx-auto max-w-[960px]">
      <div className="mb-8">
        <Link
          href="/admin/contacts"
          className="text-sm font-medium text-dim transition-colors hover:text-text"
        >
          ← Contacts
        </Link>
        <h1 className="mt-3 text-2xl font-extrabold tracking-[-0.02em]">
          New contact
        </h1>
        <p className="mt-1 text-sm text-dim">
          A WhatsApp number is required and must be unique.
        </p>
      </div>
      <ContactForm
        mode="create"
        leads={leads.map((l) => ({ id: l.id, name: l.name, phone: l.phone }))}
      />
    </div>
  )
}
