import Link from 'next/link'
import { searchLeads, type LeadFilters } from '@/features/records/queries'
import { listProducts } from '@/features/products/actions'
import { listForms } from '@/features/forms/queries'
import { listAssignableUsers } from '@/features/rbac/queries'
import { requireModuleView } from '@/features/rbac/guard'
import { scopeFor } from '@/features/rbac/can'
import LeadsViews from './LeadsViews'

/**
 * Leads list (spec §10 — Leads list; plan Task 3.2). Server component: resolves
 * the RBAC ctx, loads the filtered, scope-respecting lead set plus the product /
 * form option sets (and — for all-scope roles only — the owner options), then
 * hands everything to the client {@link LeadsViews} which owns the
 * Kanban / Table / List switch. All filtering + search runs server-side through
 * the service-role client; own-vs-all scope is enforced inside `searchLeads`.
 * Kanban is grouped by `LEAD_STATUSES`; dragging a card fires `changeLeadStatus`.
 */
export const dynamic = 'force-dynamic'

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
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
    ownerId: first(sp.ownerId),
    from: first(sp.from),
    to: first(sp.to),
    sort: first(sp.sort),
  }

  const allScope = scopeFor(ctx.permissions, 'leads') === 'all'

  const [leads, products, forms, owners] = await Promise.all([
    searchLeads(filters, undefined, ctx),
    listProducts(),
    listForms(),
    allScope ? listAssignableUsers() : Promise.resolve([]),
  ])

  // Seed the FilterBar controls from the current URL params (design: filters
  // live in the URL so a view switch preserves them and links are shareable).
  const filterValues: Record<string, string> = {
    q: filters.q ?? '',
    status: filters.status ?? '',
    productId: filters.productId ?? '',
    formId: filters.formId ?? '',
    ownerId: filters.ownerId ?? '',
    from: filters.from ?? '',
    to: filters.to ?? '',
    sort: filters.sort ?? '',
  }

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
        <div className="flex items-center gap-2">
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

      <LeadsViews
        leads={leads}
        products={products.map((p) => ({ id: p.id, name: p.name }))}
        forms={forms.map((f) => ({ id: f.id, name: f.name }))}
        owners={owners.map((u) => ({ id: u.id, label: u.email ?? u.id }))}
        filterValues={filterValues}
      />
    </div>
  )
}
