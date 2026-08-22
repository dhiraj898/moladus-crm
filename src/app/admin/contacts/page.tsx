import Link from 'next/link'
import { listContacts } from '@/features/records/queries'

/**
 * Contacts list (spec §10 — Contacts list; plan Task 11.1). Server component:
 * reads contacts through the service-role client with a name/email/whatsapp
 * search term from query params, showing the number of linked deals per row.
 */
export const dynamic = 'force-dynamic'

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d)
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const q = first(sp.q) ?? ''
  const contacts = await listContacts(q)

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-[-0.02em]">
            Contacts
          </h1>
          <p className="mt-1 text-sm text-dim">
            People who have submitted an enrollment form.
          </p>
        </div>
        <Link
          href="/admin/contacts/new"
          className="rounded-[8px] bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          New contact
        </Link>
      </div>

      <form
        method="get"
        className="mb-5 flex flex-wrap items-end gap-3 rounded-[12px] border border-line bg-surface p-4"
      >
        <label className="flex min-w-[220px] flex-1 flex-col gap-1.5">
          <span className="text-xs font-semibold text-dim">Search</span>
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Name, email or WhatsApp number"
            className="rounded-[8px] border border-line bg-bg px-3 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-accent"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded-[8px] bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Apply
          </button>
          <Link
            href="/admin/contacts"
            className="rounded-[8px] border border-line bg-surface px-4 py-2 text-sm font-medium text-dim transition-colors hover:bg-surface2 hover:text-text"
          >
            Reset
          </Link>
        </div>
      </form>

      {contacts.length === 0 ? (
        <div className="rounded-[12px] border border-line bg-surface px-6 py-16 text-center">
          <p className="text-sm font-medium text-text">No contacts found</p>
          <p className="mt-1 text-sm text-dim">
            Adjust the search or wait for new submissions to arrive.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-4 py-3 font-semibold text-dim">Name</th>
                <th className="px-4 py-3 font-semibold text-dim">WhatsApp</th>
                <th className="px-4 py-3 font-semibold text-dim">Email</th>
                <th className="px-4 py-3 font-semibold text-dim">Consent</th>
                <th className="px-4 py-3 text-right font-semibold text-dim">
                  Deals
                </th>
                <th className="px-4 py-3 text-right font-semibold text-dim">
                  Added
                </th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr
                  key={contact.id}
                  className="border-b border-line last:border-b-0 transition-colors hover:bg-surface"
                >
                  <td className="px-4 py-3 font-medium text-text">
                    <Link
                      href={`/admin/contacts/${contact.id}`}
                      className="transition-opacity hover:opacity-80"
                    >
                      {contact.name ?? 'View contact'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-dim">
                    {contact.whatsapp_number}
                  </td>
                  <td className="px-4 py-3 text-dim">{contact.email ?? '—'}</td>
                  <td className="px-4 py-3">
                    {contact.marketing_consent ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-chip-bg px-2.5 py-1 text-xs font-medium text-green">
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 rounded-full bg-green"
                        />
                        Opted in
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-chip-bg px-2.5 py-1 text-xs font-medium text-dim">
                        No
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text">
                    {contact.dealCount}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-dim">
                    {formatDate(contact.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
