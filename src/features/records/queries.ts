import 'server-only'
import { getServiceClient } from '@/lib/supabase/server'
import type {
  Contact,
  Deal,
  Lead,
  NotificationLog,
  PaymentStatus,
  Product,
  Stage,
} from '@/lib/supabase/types'

/**
 * Server-only data loaders for the admin records screens (spec §10 — Leads /
 * Deals / Contacts lists + Deal detail; plan Task 11.1).
 *
 * These are plain server functions guarded by `import 'server-only'` — NOT
 * `'use server'` actions — so they are callable only from server components and
 * other server code, never as an unauthenticated action endpoint. Every query
 * runs through the service-role client (RLS is deny-all) and every filter value
 * is validated/whitelisted before use. Free-text search is sanitised before it
 * is embedded in a PostgREST `or()` expression so a search term can never break
 * out of the query structure.
 */

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

/** Default row cap for the list screens (unbounded fetches would be unsafe). */
const LIST_LIMIT = 500

/**
 * Optional pagination for a query. When omitted, a query returns at most
 * {@link LIST_LIMIT} rows (the list-screen default). When supplied, the caller
 * drives an explicit `[offset, offset + limit)` window — used by the CSV export
 * to page through *every* matching row instead of silently truncating.
 */
export interface QueryPage {
  offset: number
  limit: number
}

// ---------------------------------------------------------------------------
// Whitelists
// ---------------------------------------------------------------------------

/** Valid deal payment statuses (mirrors the DB check constraint). */
const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'pending',
  'link_sent',
  'link_expired',
  'paid',
  'failed',
  'refunded',
]

/** Valid lead workflow statuses (leads.status; `new` is the DB default). */
const LEAD_STATUSES: readonly string[] = [
  'new',
  'contacted',
  'qualified',
  'converted',
  'lost',
]

/**
 * Strip characters that carry meaning in a PostgREST filter expression or an
 * ILIKE pattern, so a free-text term is only ever matched literally. Removes
 * the `or()` structural delimiters `, ( )`, the escape char `\`, and the LIKE
 * wildcards `% _ *`. The result is safe to interpolate into `.or(...)`.
 */
function sanitizeSearch(raw: string): string {
  return raw
    .replace(/[,()\\%_*"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

/** Coerce a value to a whitelisted member, or `undefined` when not allowed. */
function pickFrom<T extends string>(
  value: string | undefined,
  allowed: readonly T[]
): T | undefined {
  if (!value) return undefined
  return (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined
}

/** Validate a UUID-shaped filter value; returns `undefined` otherwise. */
function pickUuid(value: string | undefined): string | undefined {
  if (!value) return undefined
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  )
    ? value
    : undefined
}

/**
 * Validate a date-only (`YYYY-MM-DD`) or ISO filter value and return it as an
 * ISO string, or `undefined` when it is not a real date. `endOfDay` pushes a
 * bare date to the end of that day so an inclusive upper bound works.
 */
function pickDate(
  value: string | undefined,
  endOfDay = false
): string | undefined {
  if (!value) return undefined
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const iso = isDateOnly
    ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
    : value
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export interface LeadFilters {
  /** Free-text search across name / phone / email. */
  q?: string
  productId?: string
  formId?: string
  status?: string
}

export type LeadListItem = Lead & {
  product: { id: string; name: string } | null
  form: { id: string; name: string } | null
}

/**
 * Search leads with optional name/phone/email + product/form/status filters.
 *
 * Without `page`, returns at most {@link LIST_LIMIT} rows for the list screen.
 * With `page`, returns the explicit `[offset, offset + limit)` window so a
 * caller (the CSV export) can page through the full result set. Ordering is
 * `created_at desc, id desc` — a stable secondary key so paging never skips or
 * repeats rows that share a `created_at`.
 */
export async function searchLeads(
  filters: LeadFilters = {},
  page?: QueryPage
): Promise<LeadListItem[]> {
  const supabase = getServiceClient()

  let query = supabase
    .from('leads')
    .select('*, product:products (id, name), form:forms (id, name)')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })

  query = page
    ? query.range(page.offset, page.offset + page.limit - 1)
    : query.limit(LIST_LIMIT)

  const productId = pickUuid(filters.productId)
  if (productId) query = query.eq('product_id', productId)

  const formId = pickUuid(filters.formId)
  if (formId) query = query.eq('form_id', formId)

  const status = pickFrom(filters.status, LEAD_STATUSES)
  if (status) query = query.eq('status', status)

  const term = filters.q ? sanitizeSearch(filters.q) : ''
  if (term) {
    query = query.or(
      `name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`
    )
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to search leads: ${error.message}`)
  return (data ?? []) as unknown as LeadListItem[]
}

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

export interface DealFilters {
  paymentStatus?: string
  /** Inclusive lower bound on created_at (`YYYY-MM-DD` or ISO). */
  from?: string
  /** Inclusive upper bound on created_at (`YYYY-MM-DD` or ISO). */
  to?: string
}

export type DealListItem = Deal & {
  product: { id: string; name: string } | null
  contact: { id: string; name: string | null; whatsapp_number: string } | null
  /** Manual sales-stage name, joined from `stages` (null when unset). */
  stage_name: string | null
}

/**
 * List deals with optional payment_status + created_at date-range filters.
 *
 * Without `page`, returns at most {@link LIST_LIMIT} rows for the list screen.
 * With `page`, returns the explicit `[offset, offset + limit)` window so a
 * caller (the CSV export) can page through the full result set. Ordering is
 * `created_at desc, id desc` — a stable secondary key so paging never skips or
 * repeats rows that share a `created_at`.
 */
export async function listDeals(
  filters: DealFilters = {},
  page?: QueryPage
): Promise<DealListItem[]> {
  const supabase = getServiceClient()

  let query = supabase
    .from('deals')
    .select(
      '*, product:products (id, name), contact:contacts (id, name, whatsapp_number), stage:stages (id, name)'
    )
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })

  query = page
    ? query.range(page.offset, page.offset + page.limit - 1)
    : query.limit(LIST_LIMIT)

  const paymentStatus = pickFrom(filters.paymentStatus, PAYMENT_STATUSES)
  if (paymentStatus) query = query.eq('payment_status', paymentStatus)

  const from = pickDate(filters.from)
  if (from) query = query.gte('created_at', from)

  const to = pickDate(filters.to, true)
  if (to) query = query.lte('created_at', to)

  const { data, error } = await query
  if (error) throw new Error(`Failed to list deals: ${error.message}`)

  type Row = Omit<DealListItem, 'stage_name'> & {
    stage: { id: string; name: string } | null
  }
  return ((data ?? []) as unknown as Row[]).map((row) => {
    const { stage, ...rest } = row
    return { ...rest, stage_name: stage?.name ?? null }
  })
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export type ContactListItem = Contact & {
  /** Number of deals linked to this contact. */
  dealCount: number
}

/** List contacts, optionally filtered by a name/email/whatsapp search term. */
export async function listContacts(search = ''): Promise<ContactListItem[]> {
  const supabase = getServiceClient()

  let query = supabase
    .from('contacts')
    .select('*, deals:deals (count)')
    .order('created_at', { ascending: false })
    .limit(500)

  const term = sanitizeSearch(search)
  if (term) {
    query = query.or(
      `name.ilike.%${term}%,email.ilike.%${term}%,whatsapp_number.ilike.%${term}%`
    )
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to list contacts: ${error.message}`)

  type Row = Contact & { deals: { count: number }[] | null }
  return ((data ?? []) as unknown as Row[]).map((row) => {
    const { deals, ...contact } = row
    return { ...contact, dealCount: deals?.[0]?.count ?? 0 }
  })
}

// ---------------------------------------------------------------------------
// Deal detail (full timeline)
// ---------------------------------------------------------------------------

export interface DealTimeline {
  deal: Deal
  lead: Lead | null
  contact: Contact | null
  product: Product | null
  /** Current manual sales stage, joined from `stages` (null when unset). */
  stage: Stage | null
  notifications: NotificationLog[]
}

/**
 * Load a single deal with its full timeline: originating lead, resolved
 * contact, bound product, current stage and every notification_log row, for the
 * deal detail screen. Returns `null` when the id does not resolve to a deal.
 */
export async function getDealTimeline(id: string): Promise<DealTimeline | null> {
  if (!pickUuid(id)) return null
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('deals')
    .select(
      '*, lead:leads (*), contact:contacts (*), product:products (*), stage:stages (*), notifications:notification_log (*)'
    )
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`Failed to load deal: ${error.message}`)
  if (!data) return null

  type Row = Deal & {
    lead: Lead | null
    contact: Contact | null
    product: Product | null
    stage: Stage | null
    notifications: NotificationLog[] | null
  }
  const row = data as unknown as Row
  const { lead, contact, product, stage, notifications, ...deal } = row

  const sorted = [...(notifications ?? [])].sort((a, b) => {
    const at = a.sent_at ? new Date(a.sent_at).getTime() : 0
    const bt = b.sent_at ? new Date(b.sent_at).getTime() : 0
    return at - bt
  })

  return { deal, lead, contact, product, stage, notifications: sorted }
}

// ---------------------------------------------------------------------------
// Deal stage history
// ---------------------------------------------------------------------------

/** A stage transition with the stage name and actor email resolved for display. */
export interface DealStageHistoryItem {
  id: string
  stage_id: string
  stage_name: string | null
  actor_id: string | null
  actor_email: string | null
  entered_at: string
}

/**
 * Load a deal's stage-change history, newest first, with each stage name joined
 * and each actor id resolved to an email via the Auth admin API (memoised in a
 * small per-request cache — admins are few). A resolution failure degrades to a
 * null email rather than failing the page.
 */
export async function getDealStageHistory(
  dealId: string
): Promise<DealStageHistoryItem[]> {
  if (!pickUuid(dealId)) return []
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('deal_stage_events')
    .select('id, stage_id, actor_id, entered_at, stage:stages (name)')
    .eq('deal_id', dealId)
    .order('entered_at', { ascending: false })

  if (error) throw new Error(`Failed to load stage history: ${error.message}`)

  type Row = {
    id: string
    stage_id: string
    actor_id: string | null
    entered_at: string
    stage: { name: string } | null
  }
  const rows = (data ?? []) as unknown as Row[]

  const emailCache = new Map<string, string | null>()
  async function resolveEmail(actorId: string | null): Promise<string | null> {
    if (!actorId) return null
    if (emailCache.has(actorId)) return emailCache.get(actorId) ?? null
    try {
      const { data: userData, error: userError } =
        await supabase.auth.admin.getUserById(actorId)
      const email = userError ? null : (userData.user?.email ?? null)
      emailCache.set(actorId, email)
      return email
    } catch {
      emailCache.set(actorId, null)
      return null
    }
  }

  const items: DealStageHistoryItem[] = []
  for (const row of rows) {
    items.push({
      id: row.id,
      stage_id: row.stage_id,
      stage_name: row.stage?.name ?? null,
      actor_id: row.actor_id,
      actor_email: await resolveEmail(row.actor_id),
      entered_at: row.entered_at,
    })
  }
  return items
}
