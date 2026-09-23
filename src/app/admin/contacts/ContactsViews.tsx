'use client'

import { useMemo } from 'react'
import ViewSwitcher from '@/features/views/ViewSwitcher'
import FilterBar from '@/features/views/FilterBar'
import TableView from '@/features/views/TableView'
import ListView from '@/features/views/ListView'
import { useViewMode } from '@/features/views/useViewMode'
import type { CardDef, ColumnDef, FilterDef, ViewMode } from '@/features/views/types'
import type { ContactListItem } from '@/features/records/queries'

/**
 * Client view host for the Contacts list (plan Task 4.2). Owns the view-mode
 * switch (Table / List) and renders the shared framework components against a
 * Contacts-specific config. The server page fetches the filtered rows via
 * `listContactsFiltered`; search + consent filters live in the URL so a view
 * switch preserves them and links are shareable.
 */

const MODES: ViewMode[] = ['table', 'list']

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d)
}

export default function ContactsViews({
  contacts,
  pagination,
  filterValues,
}: {
  contacts: ContactListItem[]
  /** Page footer state for Table/List (total across all pages). */
  pagination: { total: number; page: number; pageSize: number }
  filterValues: Record<string, string>
}) {
  const [mode, setMode] = useViewMode('contacts', MODES)

  const filters = useMemo<FilterDef[]>(
    () => [
      { key: 'q', label: 'Search', type: 'search' },
      {
        key: 'consent',
        label: 'Consent',
        type: 'select',
        options: [
          { label: 'Opted in', value: 'true' },
          { label: 'Not opted in', value: 'false' },
        ],
      },
    ],
    []
  )

  const columns = useMemo<ColumnDef<ContactListItem>[]>(
    () => [
      { key: 'name', header: 'Name', render: (c) => c.name ?? 'View contact' },
      {
        key: 'whatsapp',
        header: 'WhatsApp',
        render: (c) => (
          <span className="tabular-nums">{c.whatsapp_number}</span>
        ),
      },
      { key: 'email', header: 'Email', render: (c) => c.email ?? '—' },
      {
        key: 'consent',
        header: 'Consent',
        render: (c) =>
          c.marketing_consent ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-chip-bg px-2.5 py-1 text-xs font-medium text-green">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-green" />
              Opted in
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-chip-bg px-2.5 py-1 text-xs font-medium text-dim">
              No
            </span>
          ),
      },
      {
        key: 'deals',
        header: 'Interests',
        align: 'right',
        render: (c) => <span className="text-text">{c.dealCount}</span>,
      },
      {
        key: 'created',
        header: 'Added',
        align: 'right',
        sortable: true,
        render: (c) => formatDate(c.created_at),
      },
    ],
    []
  )

  const card = useMemo<CardDef<ContactListItem>>(
    () => ({
      title: (c) => c.name ?? 'Unnamed contact',
      subtitle: (c) => c.whatsapp_number,
      href: (c) => `/admin/contacts/${c.id}`,
      meta: (c) => [
        c.marketing_consent
          ? { label: 'Opted in', tone: 'green' as const }
          : { label: 'No consent', tone: 'dim' as const },
        { label: `${c.dealCount} deals`, tone: 'dim' as const },
      ],
    }),
    []
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <ViewSwitcher modes={MODES} value={mode} onChange={setMode} />
      </div>

      <FilterBar filters={filters} values={filterValues} />

      {mode === 'table' ? (
        <TableView
          columns={columns}
          rows={contacts}
          rowKey={(c) => c.id}
          href={(c) => `/admin/contacts/${c.id}`}
          emptyTitle="No contacts found"
          emptyHint="Adjust the filters or wait for new submissions to arrive."
          pagination={pagination}
        />
      ) : (
        <ListView
          card={card}
          rows={contacts}
          rowKey={(c) => c.id}
          emptyTitle="No contacts found"
          emptyHint="Adjust the filters or wait for new submissions to arrive."
          pagination={pagination}
        />
      )}
    </div>
  )
}
