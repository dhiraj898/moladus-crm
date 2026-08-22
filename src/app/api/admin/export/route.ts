import { NextResponse, type NextRequest } from 'next/server'
import {
  searchLeads,
  listDeals,
  type LeadFilters,
  type DealFilters,
} from '@/features/records/queries'
import { getCurrentUserWithRole } from '@/features/rbac/permissions'
import { can } from '@/features/rbac/can'

/**
 * Rows to fetch per page when streaming a full export. The export pages through
 * every matching row (see {@link fetchAll}) rather than reusing the list-view
 * cap, so a large records/GST reconciliation export is never silently truncated.
 */
const EXPORT_PAGE_SIZE = 1000

/**
 * Page through a query function until it returns a short page, collecting every
 * matching row. `fetchPage(offset, limit)` must apply a stable ordering (the
 * records queries order by `created_at desc, id desc`) so no row is skipped or
 * duplicated across page boundaries.
 */
async function fetchAll<T>(
  fetchPage: (offset: number, limit: number) => Promise<T[]>
): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += EXPORT_PAGE_SIZE) {
    const page = await fetchPage(offset, EXPORT_PAGE_SIZE)
    rows.push(...page)
    if (page.length < EXPORT_PAGE_SIZE) break
  }
  return rows
}

/**
 * CSV export for leads + deals (spec §10 — CSV export; plan Task 11.2).
 *
 * `GET /api/admin/export?type=leads|deals&<filters>` returns `text/csv` as a
 * download. The route is doubly protected: the `/api/admin/:path*` middleware
 * matcher redirects unauthenticated callers, and this handler independently
 * re-verifies the Supabase session and returns 401 if it is missing — records
 * and their PII must never leak to an unauthenticated request.
 *
 * Rows are built from the SAME validated query functions as the list screens,
 * so the same whitelisting/sanitisation applies to every filter. Every CSV
 * field is quoted and escaped, and values that could be interpreted as a
 * spreadsheet formula are neutralised (CSV-injection defence).
 *
 * The export also RESPECTS RECORD SCOPE: it resolves the caller's role via
 * `getCurrentUserWithRole()` and passes that ctx to the query functions, so an
 * own-scope agent exports only their own leads/deals — never the whole table.
 */
export const dynamic = 'force-dynamic'

/**
 * Escape a single CSV field. Always quotes the value, doubles embedded quotes,
 * and prefixes a leading `= + - @` (or tab/CR) with a single quote so
 * spreadsheet apps cannot execute it as a formula.
 */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return '""'
  let s = String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

/** Join a matrix of cells into a CSV document with CRLF line endings. */
function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvField).join(',')]
  for (const row of rows) lines.push(row.map(csvField).join(','))
  return lines.join('\r\n')
}

function csvResponse(filename: string, body: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

function param(
  searchParams: URLSearchParams,
  key: string
): string | undefined {
  return searchParams.get(key) ?? undefined
}

export async function GET(request: NextRequest) {
  const ctx = await getCurrentUserWithRole()
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = request.nextUrl
  const type = searchParams.get('type')

  if (type === 'leads') {
    if (!can(ctx.permissions, 'leads', 'view')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const filters: LeadFilters = {
      q: param(searchParams, 'q'),
      status: param(searchParams, 'status'),
      productId: param(searchParams, 'productId'),
      formId: param(searchParams, 'formId'),
    }
    const leads = await fetchAll((offset, limit) =>
      searchLeads(filters, { offset, limit }, ctx)
    )
    const headers = [
      'id',
      'created_at',
      'name',
      'email',
      'phone',
      'state',
      'source',
      'status',
      'product',
      'form',
    ]
    const rows = leads.map((l) => [
      l.id,
      l.created_at ?? '',
      l.name ?? '',
      l.email ?? '',
      l.phone ?? '',
      l.state ?? '',
      l.source ?? '',
      l.status ?? '',
      l.product?.name ?? '',
      l.form?.name ?? '',
    ])
    return csvResponse('leads.csv', toCsv(headers, rows))
  }

  if (type === 'deals') {
    if (!can(ctx.permissions, 'deals', 'view')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const filters: DealFilters = {
      paymentStatus: param(searchParams, 'paymentStatus'),
      from: param(searchParams, 'from'),
      to: param(searchParams, 'to'),
    }
    const deals = await fetchAll((offset, limit) =>
      listDeals(filters, { offset, limit }, ctx)
    )
    const headers = [
      'id',
      'created_at',
      'contact_name',
      'whatsapp_number',
      'product',
      'base_amount',
      'taxable_amount',
      'cgst',
      'sgst',
      'igst',
      'total_amount',
      'place_of_supply',
      'payment_status',
      'razorpay_ref',
    ]
    const rows = deals.map((d) => [
      d.id,
      d.created_at ?? '',
      d.contact?.name ?? '',
      d.contact?.whatsapp_number ?? '',
      d.product?.name ?? '',
      d.base_amount,
      d.taxable_amount,
      d.cgst ?? 0,
      d.sgst ?? 0,
      d.igst ?? 0,
      d.total_amount,
      d.place_of_supply ?? '',
      d.payment_status ?? '',
      d.razorpay_ref ?? '',
    ])
    return csvResponse('deals.csv', toCsv(headers, rows))
  }

  return NextResponse.json(
    { error: 'Invalid export type; expected "leads" or "deals".' },
    { status: 400 }
  )
}
