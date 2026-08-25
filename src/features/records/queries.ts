import 'server-only'
import { getServiceClient } from '@/lib/supabase/server'
import { LEAD_STATUSES } from '@/features/crm/leads/schema'
import type { FormListItem } from '@/features/forms/queries'
import { ownerScopeFilter } from '@/features/rbac/can'
import type { CurrentUserWithRole } from '@/features/rbac/permissions'
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

/**
 * The result of a paged list query: the requested window of `rows` plus the
 * `total` count of *all* rows matching the same RBAC scope + filters (via
 * Supabase `{ count: 'exact' }`). The UI derives "Page X of Y" from `total`.
 */
export interface PagedResult<T> {
  rows: T[]
  total: number
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

/**
 * Coerce a `'true'` / `'false'` filter value to a boolean, or `undefined` when
 * the value is absent or anything else (so an unset tri-state filter is a no-op).
 */
function pickBool(value: string | undefined): boolean | undefined {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
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
  /** Owner filter (applied only for RBAC all-scope callers). */
  ownerId?: string
  /** Inclusive lower bound on created_at (`YYYY-MM-DD` or ISO). */
  from?: string
  /** Inclusive upper bound on created_at (`YYYY-MM-DD` or ISO). */
  to?: string
  /** One of {@link LEAD_SORTS}; defaults to `created_desc`. */
  sort?: string
}

/**
 * Valid lead sort keys mapped to their ordered `[column, ascending]` pairs.
 * Every key ends on `id` as a stable secondary tiebreaker so paging is
 * deterministic. Unknown keys fall back to `created_desc`.
 */
const LEAD_SORTS: Record<string, [column: string, ascending: boolean][]> = {
  created_desc: [
    ['created_at', false],
    ['id', false],
  ],
  created_asc: [
    ['created_at', true],
    ['id', true],
  ],
  name_asc: [
    ['name', true],
    ['id', true],
  ],
  name_desc: [
    ['name', false],
    ['id', false],
  ],
}

export type LeadListItem = Lead & {
  product: { id: string; name: string } | null
  form: { id: string; name: string } | null
}

const LEAD_SELECT = '*, product:products (id, name), form:forms (id, name)'

/**
 * Build the leads query with ordering + RBAC scope + every declared filter
 * applied, but WITHOUT the row window (`.range`/`.limit`). Shared by
 * {@link searchLeads} (array) and {@link searchLeadsPaged} ({rows,total}) so the
 * scope + filter logic lives in exactly one place — a page/offset param can
 * never widen the RBAC scope because the scope is re-derived here every call.
 * When `withCount` is set, the count of the full matching set is requested.
 */
function buildLeadsQuery(
  filters: LeadFilters,
  ctx: CurrentUserWithRole | undefined,
  withCount: boolean
) {
  const supabase = getServiceClient()

  let query = supabase
    .from('leads')
    .select(LEAD_SELECT, withCount ? { count: 'exact' } : undefined)

  // Ordering: a validated sort key (default `created_desc`), always ending on
  // `id` so paging stays deterministic across rows sharing the sort column.
  const sort = LEAD_SORTS[filters.sort ?? ''] ?? LEAD_SORTS.created_desc
  for (const [column, ascending] of sort) {
    query = query.order(column, { ascending })
  }

  // Own-scope roles see only leads they are assigned (owner_id); all-scope
  // callers may additionally narrow to a specific owner via the filter.
  if (ctx) {
    const scopedOwner = ownerScopeFilter(ctx.permissions, 'leads', ctx.user.id)
    if (scopedOwner) query = query.eq('owner_id', scopedOwner)
    else {
      const ownerId = pickUuid(filters.ownerId)
      if (ownerId) query = query.eq('owner_id', ownerId)
    }
  }

  const productId = pickUuid(filters.productId)
  if (productId) query = query.eq('product_id', productId)

  const formId = pickUuid(filters.formId)
  if (formId) query = query.eq('form_id', formId)

  const status = pickFrom(filters.status, LEAD_STATUSES)
  if (status) query = query.eq('status', status)

  const from = pickDate(filters.from)
  if (from) query = query.gte('created_at', from)

  const to = pickDate(filters.to, true)
  if (to) query = query.lte('created_at', to)

  const term = filters.q ? sanitizeSearch(filters.q) : ''
  if (term) {
    query = query.or(
      `name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`
    )
  }

  return query
}

/**
 * Search leads with optional name/phone/email + product/form/status filters.
 *
 * Without `page`, returns at most {@link LIST_LIMIT} rows for the list screen.
 * With `page`, returns the explicit `[offset, offset + limit)` window so a
 * caller (the CSV export) can page through the full result set. Ordering is
 * `created_at desc, id desc` — a stable secondary key so paging never skips or
 * repeats rows that share a `created_at`.
 *
 * When `ctx` is supplied and the role's `leads` scope is `own`, results are
 * filtered to the caller's own records (`owner_id`), so own-scope agents — and
 * the CSV export run on their behalf — see only leads assigned to them.
 */
export async function searchLeads(
  filters: LeadFilters = {},
  page?: QueryPage,
  ctx?: CurrentUserWithRole
): Promise<LeadListItem[]> {
  const base = buildLeadsQuery(filters, ctx, false)
  const query = page
    ? base.range(page.offset, page.offset + page.limit - 1)
    : base.limit(LIST_LIMIT)

  const { data, error } = await query
  if (error) throw new Error(`Failed to search leads: ${error.message}`)
  return (data ?? []) as unknown as LeadListItem[]
}

/**
 * Paged variant of {@link searchLeads} — returns the requested window plus the
 * `total` count of all leads matching the same RBAC scope + filters (via
 * `{ count: 'exact' }`). Drives the Table/List pagination control. The scope +
 * filters are re-derived server-side in {@link buildLeadsQuery}, so a client
 * cannot widen its scope through the `page` window.
 */
export async function searchLeadsPaged(
  filters: LeadFilters,
  page: QueryPage,
  ctx?: CurrentUserWithRole
): Promise<PagedResult<LeadListItem>> {
  const query = buildLeadsQuery(filters, ctx, true).range(
    page.offset,
    page.offset + page.limit - 1
  )

  const { data, error, count } = await query
  if (error) throw new Error(`Failed to search leads: ${error.message}`)
  return { rows: (data ?? []) as unknown as LeadListItem[], total: count ?? 0 }
}

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

export interface DealFilters {
  /** Free-text search across the linked contact + product (see below). */
  q?: string
  paymentStatus?: string
  /** Manual sales-stage id. */
  stageId?: string
  /** Owner filter (applied only for RBAC all-scope callers). */
  ownerId?: string
  /** Inclusive lower bound on created_at (`YYYY-MM-DD` or ISO). */
  from?: string
  /** Inclusive upper bound on created_at (`YYYY-MM-DD` or ISO). */
  to?: string
  /** One of {@link DEAL_SORTS}; defaults to `created_desc`. */
  sort?: string
}

/**
 * Valid deal sort keys mapped to their ordered `[column, ascending]` pairs.
 * Every key ends on `id` as a stable secondary tiebreaker so paging is
 * deterministic. Unknown keys fall back to `created_desc`.
 */
const DEAL_SORTS: Record<string, [column: string, ascending: boolean][]> = {
  created_desc: [
    ['created_at', false],
    ['id', false],
  ],
  created_asc: [
    ['created_at', true],
    ['id', true],
  ],
  total_desc: [
    ['total_amount', false],
    ['id', false],
  ],
  total_asc: [
    ['total_amount', true],
    ['id', true],
  ],
}

export type DealListItem = Deal & {
  product: { id: string; name: string } | null
  contact: { id: string; name: string | null; whatsapp_number: string } | null
  /** Manual sales-stage name, joined from `stages` (null when unset). */
  stage_name: string | null
}

const DEAL_SELECT =
  '*, product:products (id, name), contact:contacts (id, name, whatsapp_number), stage:stages (id, name)'

/** Resolved contact/product ids a free-text deal search matched, or a sentinel
 * that no id matched (so the caller short-circuits to an empty result). */
type DealSearchIds =
  | { contactIds: string[]; productIds: string[] }
  | 'no-match'
  | null

/**
 * Free-text deal search has no own text column to match on, so resolve the
 * linked contacts + products whose name/number matches the term first, then the
 * caller keeps deals pointing at either. A present term that matches nothing
 * returns `'no-match'` so the caller returns an empty page without a deal query.
 */
async function resolveDealSearchIds(term: string): Promise<DealSearchIds> {
  if (!term) return null
  const supabase = getServiceClient()
  const [{ data: contactRows }, { data: productRows }] = await Promise.all([
    supabase
      .from('contacts')
      .select('id')
      .or(`name.ilike.%${term}%,whatsapp_number.ilike.%${term}%`)
      .limit(LIST_LIMIT),
    supabase
      .from('products')
      .select('id')
      .ilike('name', `%${term}%`)
      .limit(LIST_LIMIT),
  ])
  const contactIds = ((contactRows ?? []) as { id: string }[]).map((r) => r.id)
  const productIds = ((productRows ?? []) as { id: string }[]).map((r) => r.id)
  if (contactIds.length === 0 && productIds.length === 0) return 'no-match'
  return { contactIds, productIds }
}

/**
 * Build the deals query with ordering + RBAC scope + every declared filter
 * (including the resolved free-text `searchIds`) applied, but WITHOUT the row
 * window. Shared by {@link listDeals} and {@link listDealsPaged} so scope +
 * filters live in one place and a page/offset param can never widen scope.
 */
function buildDealsQuery(
  filters: DealFilters,
  ctx: CurrentUserWithRole | undefined,
  searchIds: Exclude<DealSearchIds, 'no-match'>,
  withCount: boolean
) {
  const supabase = getServiceClient()

  let query = supabase
    .from('deals')
    .select(DEAL_SELECT, withCount ? { count: 'exact' } : undefined)

  // Ordering: a validated sort key (default `created_desc`), always ending on
  // `id` so paging stays deterministic across rows sharing the sort column.
  const sort = DEAL_SORTS[filters.sort ?? ''] ?? DEAL_SORTS.created_desc
  for (const [column, ascending] of sort) {
    query = query.order(column, { ascending })
  }

  // Own-scope roles see only deals they are assigned (owner_id); all-scope
  // callers may additionally narrow to a specific owner via the filter.
  if (ctx) {
    const scopedOwner = ownerScopeFilter(ctx.permissions, 'deals', ctx.user.id)
    if (scopedOwner) query = query.eq('owner_id', scopedOwner)
    else {
      const ownerId = pickUuid(filters.ownerId)
      if (ownerId) query = query.eq('owner_id', ownerId)
    }
  }

  if (searchIds) {
    const clauses: string[] = []
    if (searchIds.contactIds.length > 0)
      clauses.push(`contact_id.in.(${searchIds.contactIds.join(',')})`)
    if (searchIds.productIds.length > 0)
      clauses.push(`product_id.in.(${searchIds.productIds.join(',')})`)
    query = query.or(clauses.join(','))
  }

  const paymentStatus = pickFrom(filters.paymentStatus, PAYMENT_STATUSES)
  if (paymentStatus) query = query.eq('payment_status', paymentStatus)

  const stageId = pickUuid(filters.stageId)
  if (stageId) query = query.eq('stage_id', stageId)

  const from = pickDate(filters.from)
  if (from) query = query.gte('created_at', from)

  const to = pickDate(filters.to, true)
  if (to) query = query.lte('created_at', to)

  return query
}

/** Map a joined deal row (with a nested `stage`) to the flat {@link DealListItem}. */
function toDealListItem(row: unknown): DealListItem {
  type Row = Omit<DealListItem, 'stage_name'> & {
    stage: { id: string; name: string } | null
  }
  const { stage, ...rest } = row as Row
  return { ...rest, stage_name: stage?.name ?? null }
}

/**
 * List deals with optional payment_status + created_at date-range filters.
 *
 * Without `page`, returns at most {@link LIST_LIMIT} rows for the list screen.
 * With `page`, returns the explicit `[offset, offset + limit)` window so a
 * caller (the CSV export) can page through the full result set. Ordering is
 * `created_at desc, id desc` — a stable secondary key so paging never skips or
 * repeats rows that share a `created_at`.
 *
 * When `ctx` is supplied and the role's `deals` scope is `own`, results are
 * filtered to the caller's own records (`owner_id`), so own-scope agents — and
 * the CSV export run on their behalf — see only deals assigned to them.
 */
export async function listDeals(
  filters: DealFilters = {},
  page?: QueryPage,
  ctx?: CurrentUserWithRole
): Promise<DealListItem[]> {
  const term = filters.q ? sanitizeSearch(filters.q) : ''
  const searchIds = await resolveDealSearchIds(term)
  if (searchIds === 'no-match') return []

  const base = buildDealsQuery(filters, ctx, searchIds, false)
  const query = page
    ? base.range(page.offset, page.offset + page.limit - 1)
    : base.limit(LIST_LIMIT)

  const { data, error } = await query
  if (error) throw new Error(`Failed to list deals: ${error.message}`)
  return ((data ?? []) as unknown[]).map(toDealListItem)
}

/**
 * Paged variant of {@link listDeals} — returns the requested window plus the
 * `total` count of all deals matching the same RBAC scope + filters (via
 * `{ count: 'exact' }`). Drives the Table/List pagination control. Scope +
 * filters are re-derived server-side, so a client cannot widen scope through the
 * `page` window. A free-text term that matches no contact/product returns an
 * empty page with `total: 0`.
 */
export async function listDealsPaged(
  filters: DealFilters,
  page: QueryPage,
  ctx?: CurrentUserWithRole
): Promise<PagedResult<DealListItem>> {
  const term = filters.q ? sanitizeSearch(filters.q) : ''
  const searchIds = await resolveDealSearchIds(term)
  if (searchIds === 'no-match') return { rows: [], total: 0 }

  const query = buildDealsQuery(filters, ctx, searchIds, true).range(
    page.offset,
    page.offset + page.limit - 1
  )

  const { data, error, count } = await query
  if (error) throw new Error(`Failed to list deals: ${error.message}`)
  return { rows: ((data ?? []) as unknown[]).map(toDealListItem), total: count ?? 0 }
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

export interface ContactFilters {
  /** Free-text search across name / email / whatsapp number. */
  q?: string
  /** Marketing-consent tri-state (`'true'` / `'false'`; anything else = all). */
  consent?: string
}

/**
 * Build the contacts query with ordering + consent/search filters applied, but
 * WITHOUT the row window. Shared by {@link listContactsFiltered} (array) and
 * {@link listContactsPaged} ({rows,total}). Contacts are not owner-scoped, so
 * there is no RBAC scope to widen via the page window.
 */
function buildContactsQuery(filters: ContactFilters, withCount: boolean) {
  const supabase = getServiceClient()

  let query = supabase
    .from('contacts')
    .select('*, deals:deals (count)', withCount ? { count: 'exact' } : undefined)
    .order('created_at', { ascending: false })

  const consent = pickBool(filters.consent)
  if (consent !== undefined) query = query.eq('marketing_consent', consent)

  const term = filters.q ? sanitizeSearch(filters.q) : ''
  if (term) {
    query = query.or(
      `name.ilike.%${term}%,email.ilike.%${term}%,whatsapp_number.ilike.%${term}%`
    )
  }

  return query
}

/** Map a joined contact row (with a nested deals-count) to {@link ContactListItem}. */
function toContactListItem(row: unknown): ContactListItem {
  type Row = Contact & { deals: { count: number }[] | null }
  const { deals, ...contact } = row as Row
  return { ...contact, dealCount: deals?.[0]?.count ?? 0 }
}

/**
 * List contacts with an optional name/email/whatsapp search term and a
 * marketing-consent filter, each row carrying its linked-deal count. Returns at
 * most {@link LIST_LIMIT} rows, newest first. Server-only; the free-text term is
 * sanitised before it is interpolated into the PostgREST `or()` expression.
 */
export async function listContactsFiltered(
  filters: ContactFilters = {}
): Promise<ContactListItem[]> {
  const { data, error } = await buildContactsQuery(filters, false).limit(
    LIST_LIMIT
  )
  if (error) throw new Error(`Failed to list contacts: ${error.message}`)
  return ((data ?? []) as unknown[]).map(toContactListItem)
}

/**
 * Paged variant of {@link listContactsFiltered} — returns the requested window
 * plus the `total` count of all contacts matching the same filters (via
 * `{ count: 'exact' }`). Drives the Table/List pagination control.
 */
export async function listContactsPaged(
  filters: ContactFilters,
  page: QueryPage
): Promise<PagedResult<ContactListItem>> {
  const { data, error, count } = await buildContactsQuery(filters, true).range(
    page.offset,
    page.offset + page.limit - 1
  )
  if (error) throw new Error(`Failed to list contacts: ${error.message}`)
  return {
    rows: ((data ?? []) as unknown[]).map(toContactListItem),
    total: count ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface ProductFilters {
  /** Free-text search across name / code. */
  q?: string
  /** Active tri-state (`'true'` / `'false'`; anything else = all). */
  active?: string
}

/**
 * Build the products query with ordering + active/search filters applied, but
 * WITHOUT the row window. Shared by {@link listProductsFiltered} (array) and
 * {@link listProductsPaged} ({rows,total}).
 */
function buildProductsQuery(filters: ProductFilters, withCount: boolean) {
  const supabase = getServiceClient()

  let query = supabase
    .from('products')
    .select('*', withCount ? { count: 'exact' } : undefined)
    .order('created_at', { ascending: false })

  const active = pickBool(filters.active)
  if (active !== undefined) query = query.eq('active', active)

  const term = filters.q ? sanitizeSearch(filters.q) : ''
  if (term) {
    query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%`)
  }

  return query
}

/**
 * List products with an optional name/code search term and an active filter.
 * Returns at most {@link LIST_LIMIT} rows, newest first. Server-only; the
 * free-text term is sanitised before it is interpolated into the PostgREST
 * `or()` expression.
 */
export async function listProductsFiltered(
  filters: ProductFilters = {}
): Promise<Product[]> {
  const { data, error } = await buildProductsQuery(filters, false).limit(
    LIST_LIMIT
  )
  if (error) throw new Error(`Failed to list products: ${error.message}`)
  return (data ?? []) as Product[]
}

/**
 * Paged variant of {@link listProductsFiltered} — returns the requested window
 * plus the `total` count of all products matching the same filters (via
 * `{ count: 'exact' }`). Drives the Table/List pagination control.
 */
export async function listProductsPaged(
  filters: ProductFilters,
  page: QueryPage
): Promise<PagedResult<Product>> {
  const { data, error, count } = await buildProductsQuery(filters, true).range(
    page.offset,
    page.offset + page.limit - 1
  )
  if (error) throw new Error(`Failed to list products: ${error.message}`)
  return { rows: (data ?? []) as Product[], total: count ?? 0 }
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

/** Valid form statuses (mirrors the `FormStatus` DB check constraint). */
const FORM_STATUSES = ['draft', 'published'] as const

export interface FormFilters {
  /** Free-text search across name / slug. */
  q?: string
  /** One of {@link FORM_STATUSES}; anything else = all. */
  status?: string
  /** Bound-product filter (UUID). */
  productId?: string
}

/**
 * Build the forms query with ordering + status/product/search filters applied,
 * but WITHOUT the row window. Shared by {@link listFormsFiltered} (array) and
 * {@link listFormsPaged} ({rows,total}).
 */
function buildFormsQuery(filters: FormFilters, withCount: boolean) {
  const supabase = getServiceClient()

  let query = supabase
    .from('forms')
    .select(
      '*, product:products (id, name, active)',
      withCount ? { count: 'exact' } : undefined
    )
    .order('created_at', { ascending: false })

  const status = pickFrom(filters.status, FORM_STATUSES)
  if (status) query = query.eq('status', status)

  const productId = pickUuid(filters.productId)
  if (productId) query = query.eq('product_id', productId)

  const term = filters.q ? sanitizeSearch(filters.q) : ''
  if (term) {
    query = query.or(`name.ilike.%${term}%,slug.ilike.%${term}%`)
  }

  return query
}

/**
 * List forms with an optional name/slug search term plus status and bound-product
 * filters, each row joined with its product name. Returns at most
 * {@link LIST_LIMIT} rows, newest first. Server-only; the free-text term is
 * sanitised before it is interpolated into the PostgREST `or()` expression.
 */
export async function listFormsFiltered(
  filters: FormFilters = {}
): Promise<FormListItem[]> {
  const { data, error } = await buildFormsQuery(filters, false).limit(
    LIST_LIMIT
  )
  if (error) throw new Error(`Failed to list forms: ${error.message}`)
  return (data ?? []) as unknown as FormListItem[]
}

/**
 * Paged variant of {@link listFormsFiltered} — returns the requested window plus
 * the `total` count of all forms matching the same filters (via
 * `{ count: 'exact' }`). Drives the Table/List pagination control.
 */
export async function listFormsPaged(
  filters: FormFilters,
  page: QueryPage
): Promise<PagedResult<FormListItem>> {
  const { data, error, count } = await buildFormsQuery(filters, true).range(
    page.offset,
    page.offset + page.limit - 1
  )
  if (error) throw new Error(`Failed to list forms: ${error.message}`)
  return {
    rows: (data ?? []) as unknown as FormListItem[],
    total: count ?? 0,
  }
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
 *
 * When `ctx` is supplied and the role's `deals` scope is `own`, an own-scope
 * caller cannot deep-link into another agent's deal: if the loaded row is not
 * owned by the caller, this returns `null` (indistinguishable from not-found).
 */
export async function getDealTimeline(
  id: string,
  ctx?: CurrentUserWithRole
): Promise<DealTimeline | null> {
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

  // Own-scope callers may only open their own deals.
  if (ctx) {
    const ownerId = ownerScopeFilter(ctx.permissions, 'deals', ctx.user.id)
    if (ownerId && row.owner_id !== ownerId) return null
  }

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

// ---------------------------------------------------------------------------
// Lead / Contact detail (spec §6 — Lead + Contact detail pages)
// ---------------------------------------------------------------------------

/** Resolve a single actor id to an email via the Auth admin API, or null. */
async function resolveActorEmail(
  supabase: ReturnType<typeof getServiceClient>,
  actorId: string | null
): Promise<string | null> {
  if (!actorId) return null
  try {
    const { data, error } = await supabase.auth.admin.getUserById(actorId)
    return error ? null : (data.user?.email ?? null)
  } catch {
    return null
  }
}

/** A deal summarised for the linked-deals list on a lead/contact detail page. */
export interface LinkedDeal {
  id: string
  product_name: string | null
  stage_name: string | null
  total_amount: number
  payment_status: PaymentStatus | null
  created_at: string | null
}

/** Shape returned by the deals join used for linked-deal lists. */
type LinkedDealRow = {
  id: string
  total_amount: number
  payment_status: PaymentStatus | null
  created_at: string | null
  product: { name: string } | null
  stage: { name: string } | null
}

/** Map a joined deal row to the trimmed {@link LinkedDeal} shape. */
function toLinkedDeal(row: LinkedDealRow): LinkedDeal {
  return {
    id: row.id,
    product_name: row.product?.name ?? null,
    stage_name: row.stage?.name ?? null,
    total_amount: row.total_amount,
    payment_status: row.payment_status,
    created_at: row.created_at,
  }
}

const LINKED_DEAL_SELECT =
  'id, total_amount, payment_status, created_at, product:products (name), stage:stages (name)'

export interface LeadDetail {
  lead: Lead
  /** Resolved email of the lead owner (null when unowned / unresolved). */
  owner_email: string | null
  /** The contact created from this lead, if any. */
  contact: Contact | null
  /** Deals originating from this lead, newest first. */
  deals: LinkedDeal[]
}

/**
 * Load a single lead with its linked contact, its deals (with product + stage
 * names), and its owner's email for the lead detail screen. Returns `null` when
 * the id is malformed or does not resolve to a lead.
 *
 * When `ctx` is supplied and the role's `leads` scope is `own`, an own-scope
 * caller cannot deep-link into another agent's lead: if the loaded row is not
 * owned by the caller, this returns `null` (indistinguishable from not-found).
 */
export async function getLeadDetail(
  id: string,
  ctx?: CurrentUserWithRole
): Promise<LeadDetail | null> {
  if (!pickUuid(id)) return null
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`Failed to load lead: ${error.message}`)
  if (!data) return null
  const lead = data as unknown as Lead

  // Own-scope callers may only open their own leads.
  if (ctx) {
    const ownerId = ownerScopeFilter(ctx.permissions, 'leads', ctx.user.id)
    if (ownerId && lead.owner_id !== ownerId) return null
  }

  const [{ data: contactRow }, { data: dealRows }, owner_email] =
    await Promise.all([
      supabase
        .from('contacts')
        .select('*')
        .eq('lead_id', id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('deals')
        .select(LINKED_DEAL_SELECT)
        .eq('lead_id', id)
        .order('created_at', { ascending: false }),
      resolveActorEmail(supabase, lead.owner_id),
    ])

  const deals = ((dealRows ?? []) as unknown as LinkedDealRow[]).map(
    toLinkedDeal
  )

  return {
    lead,
    owner_email,
    contact: (contactRow as unknown as Contact | null) ?? null,
    deals,
  }
}

export interface ContactDetail {
  contact: Contact
  /** The lead this contact originated from, if any. */
  lead: Lead | null
  /** Deals linked to this contact, newest first. */
  deals: LinkedDeal[]
}

/**
 * Load a single contact with its originating lead and its deals (with product +
 * stage names) for the contact detail screen. Returns `null` when the id is
 * malformed or does not resolve to a contact.
 */
export async function getContactDetail(
  id: string
): Promise<ContactDetail | null> {
  if (!pickUuid(id)) return null
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`Failed to load contact: ${error.message}`)
  if (!data) return null
  const contact = data as unknown as Contact

  const [{ data: leadRow }, { data: dealRows }] = await Promise.all([
    contact.lead_id
      ? supabase
          .from('leads')
          .select('*')
          .eq('id', contact.lead_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('deals')
      .select(LINKED_DEAL_SELECT)
      .eq('contact_id', id)
      .order('created_at', { ascending: false }),
  ])

  const deals = ((dealRows ?? []) as unknown as LinkedDealRow[]).map(
    toLinkedDeal
  )

  return {
    contact,
    lead: (leadRow as unknown as Lead | null) ?? null,
    deals,
  }
}
