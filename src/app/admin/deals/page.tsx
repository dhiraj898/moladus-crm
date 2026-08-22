import Link from 'next/link'
import { listDeals, type DealFilters } from '@/features/records/queries'
import { formatMoney } from '@/features/form-engine/estimate'
import PaymentStatusChip from '@/features/records/PaymentStatusChip'
import type { PaymentStatus } from '@/lib/supabase/types'

/**
 * Deals list (spec §10 — Deals list; plan Task 11.1). Server component: reads
 * deals through the service-role client with payment_status + created_at
 * date-range filters from query params. All amounts render with tabular
 * numerals and are derived from stored GST columns (never recomputed here).
 */
export const dynamic = 'force-dynamic'

const PAYMENT_STATUS_OPTIONS: readonly PaymentStatus[] = [
  'pending',
  'link_sent',
  'link_expired',
  'paid',
  'failed',
  'refunded',
]

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d)
}

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const filters: DealFilters = {
    paymentStatus: first(sp.paymentStatus),
    from: first(sp.from),
    to: first(sp.to),
  }
  const deals = await listDeals(filters)

  const exportParams = new URLSearchParams({ type: 'deals' })
  if (filters.paymentStatus)
    exportParams.set('paymentStatus', filters.paymentStatus)
  if (filters.from) exportParams.set('from', filters.from)
  if (filters.to) exportParams.set('to', filters.to)

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-[-0.02em]">Deals</h1>
          <p className="mt-1 text-sm text-dim">
            Enrollment deals and their payment state.
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
            href="/admin/deals/new"
            className="rounded-[8px] bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            New deal
          </Link>
        </div>
      </div>

      <form
        method="get"
        className="mb-5 flex flex-wrap items-end gap-3 rounded-[12px] border border-line bg-surface p-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-dim">Payment status</span>
          <select
            name="paymentStatus"
            defaultValue={filters.paymentStatus ?? ''}
            className="rounded-[8px] border border-line bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent"
          >
            <option value="">All</option>
            {PAYMENT_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-dim">From</span>
          <input
            type="date"
            name="from"
            defaultValue={filters.from ?? ''}
            className="rounded-[8px] border border-line bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-dim">To</span>
          <input
            type="date"
            name="to"
            defaultValue={filters.to ?? ''}
            className="rounded-[8px] border border-line bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent"
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
            href="/admin/deals"
            className="rounded-[8px] border border-line bg-surface px-4 py-2 text-sm font-medium text-dim transition-colors hover:bg-surface2 hover:text-text"
          >
            Reset
          </Link>
        </div>
      </form>

      {deals.length === 0 ? (
        <div className="rounded-[12px] border border-line bg-surface px-6 py-16 text-center">
          <p className="text-sm font-medium text-text">No deals found</p>
          <p className="mt-1 text-sm text-dim">
            Adjust the filters or wait for new enrollments to convert.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-4 py-3 font-semibold text-dim">Contact</th>
                <th className="px-4 py-3 font-semibold text-dim">Product</th>
                <th className="px-4 py-3 font-semibold text-dim">Stage</th>
                <th className="px-4 py-3 text-right font-semibold text-dim">
                  Total
                </th>
                <th className="px-4 py-3 font-semibold text-dim">Payment</th>
                <th className="px-4 py-3 text-right font-semibold text-dim">
                  Created
                </th>
                <th className="px-4 py-3 text-right font-semibold text-dim">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {deals.map((deal) => (
                <tr
                  key={deal.id}
                  className="border-b border-line last:border-b-0"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-text">
                      {deal.contact?.name ?? '—'}
                    </div>
                    {deal.contact?.whatsapp_number ? (
                      <div className="tabular-nums text-faint">
                        {deal.contact.whatsapp_number}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-dim">
                    {deal.product?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-dim">{deal.stage_name ?? '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-text">
                    {formatMoney(deal.total_amount)}
                  </td>
                  <td className="px-4 py-3">
                    <PaymentStatusChip status={deal.payment_status} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-dim">
                    {formatDate(deal.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/deals/${deal.id}`}
                      className="text-sm font-medium text-accent transition-opacity hover:opacity-80"
                    >
                      View
                    </Link>
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
