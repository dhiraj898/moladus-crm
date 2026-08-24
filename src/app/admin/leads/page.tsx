import Link from 'next/link'
import { searchLeads, type LeadFilters } from '@/features/records/queries'
import { LEAD_STATUSES } from '@/features/crm/leads/schema'
import { requireModuleView } from '@/features/rbac/guard'

/**
 * Leads list (spec §10 — Leads list; plan Task 11.1). Server component: reads
 * leads through the service-role client with name/phone/email search and
 * product/form/status filters supplied as query params, and renders the
 * design-system table. Amounts are not shown here (leads pre-date pricing); the
 * numeric-heavy views live on Deals.
 */
export const dynamic = 'force-dynamic'

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireModuleView('leads')
  const sp = await searchParams
  const filters: LeadFilters = {
    q: first(sp.q),
    status: first(sp.status),
    productId: first(sp.productId),
    formId: first(sp.formId),
  }
  const leads = await searchLeads(filters, undefined, ctx)

  const exportParams = new URLSearchParams({ type: 'leads' })
  if (filters.q) exportParams.set('q', filters.q)
  if (filters.status) exportParams.set('status', filters.status)
  if (filters.productId) exportParams.set('productId', filters.productId)
  if (filters.formId) exportParams.set('formId', filters.formId)

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-[-0.02em]">Leads</h1>
          <p className="mt-1 text-sm text-dim">
            Every enrollment submission, newest first.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`/api/admin/export?${exportParams.toString()}`}
            className="rounded-[8px] border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-text transition-colors hover:bg-surface2"
          >
            Export CSV
          </a>
          <Link
            href="/admin/leads/new"
            className="rounded-[8px] bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            New lead
          </Link>
        </div>
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
            defaultValue={filters.q ?? ''}
            placeholder="Name, phone or email"
            className="rounded-[8px] border border-line bg-bg px-3 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-dim">Status</span>
          <select
            name="status"
            defaultValue={filters.status ?? ''}
            className="rounded-[8px] border border-line bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent"
          >
            <option value="">All</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded-[8px] bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Apply
          </button>
          <Link
            href="/admin/leads"
            className="rounded-[8px] border border-line bg-surface px-4 py-2 text-sm font-medium text-dim transition-colors hover:bg-surface2 hover:text-text"
          >
            Reset
          </Link>
        </div>
      </form>

      {leads.length === 0 ? (
        <div className="rounded-[12px] border border-line bg-surface px-6 py-16 text-center">
          <p className="text-sm font-medium text-text">No leads found</p>
          <p className="mt-1 text-sm text-dim">
            Adjust the filters or wait for new submissions to arrive.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-4 py-3 font-semibold text-dim">Name</th>
                <th className="px-4 py-3 font-semibold text-dim">Contact</th>
                <th className="px-4 py-3 font-semibold text-dim">Product</th>
                <th className="px-4 py-3 font-semibold text-dim">Form</th>
                <th className="px-4 py-3 font-semibold text-dim">Status</th>
                <th className="px-4 py-3 text-right font-semibold text-dim">
                  Submitted
                </th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr
                  key={lead.id}
                  className="border-b border-line last:border-b-0 transition-colors hover:bg-surface"
                >
                  <td className="px-4 py-3 font-medium text-text">
                    <Link
                      href={`/admin/leads/${lead.id}`}
                      className="transition-opacity hover:opacity-80"
                    >
                      {lead.name ?? 'View lead'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-dim">
                    <div className="tabular-nums">{lead.phone ?? '—'}</div>
                    {lead.email ? (
                      <div className="text-faint">{lead.email}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-dim">
                    {lead.product?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-dim">
                    {lead.form?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-chip-bg px-2.5 py-1 text-xs font-medium text-dim">
                      {lead.status ?? 'Not Contacted'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-dim">
                    {formatDateTime(lead.created_at)}
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
