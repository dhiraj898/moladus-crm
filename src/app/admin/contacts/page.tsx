import Link from 'next/link'
import { listContactsPaged, type ContactFilters } from '@/features/records/queries'
import { clampPageSize } from '@/features/views/paginationMath'
import { fetchPagedClamped } from '@/features/views/fetchPagedClamped'
import ContactsViews from './ContactsViews'

/**
 * Contacts list (spec §10 — Contacts list; plan Task 4.2). Server component:
 * loads the filtered contact set (name/email/whatsapp search + consent) through
 * the service-role client, then hands it to the client {@link ContactsViews}
 * which owns the Table / List switch. All filtering runs server-side; filters
 * live in the URL so a view switch preserves them and links are shareable.
 */
export const dynamic = 'force-dynamic'

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams

  const filters: ContactFilters = {
    q: first(sp.q),
    consent: first(sp.consent),
  }

  // Table/List pagination — URL is the source of truth (default 25/page); an
  // out-of-range `?page` is corrected to the last page by `fetchPagedClamped`.
  const pageSize = clampPageSize(first(sp.pageSize))
  const {
    rows: contacts,
    total,
    page,
  } = await fetchPagedClamped(first(sp.page), pageSize, (window) =>
    listContactsPaged(filters, window)
  )

  const filterValues: Record<string, string> = {
    q: filters.q ?? '',
    consent: filters.consent ?? '',
  }

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

      <ContactsViews
        contacts={contacts}
        pagination={{ total, page, pageSize }}
        filterValues={filterValues}
      />
    </div>
  )
}
