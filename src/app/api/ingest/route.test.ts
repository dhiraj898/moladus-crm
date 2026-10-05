import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Product } from '@/lib/supabase/types'

/**
 * Integration tests for the public submission route's multi-line order creation
 * (plan WS6). The form loader, bindings/validation, service-role client, entry
 * stage resolver, stage on-enter actions, activity log, assignment, webhook
 * emit, rate limiter, and captcha are all mocked so these run without a live DB
 * or live keys. `buildOrderItems`/`computeGST` are NOT mocked — the aggregated
 * totals and per-line snapshots are exercised for real.
 *
 * Coverage: a 2-item selection inserts ONE `deals` row (product_id null,
 * form_id set, aggregated totals) + TWO snapshotted `deal_items`; an empty
 * selection → 400; an id not offered (or inactive) is excluded, and an
 * all-invalid selection → 400.
 */

interface CapturedInserts {
  [table: string]: unknown[]
}

const db: {
  existingContact: { id: string } | null
  leadId: string
  contactRow: Record<string, unknown>
  dealInsertError: { code?: string } | null
  dealId: string
  itemsError: unknown
  dealLinkUrl: string | null
  inserts: CapturedInserts
} = {
  existingContact: null,
  leadId: 'lead-1',
  contactRow: { id: 'contact-1', name: 'Asha', email: null, whatsapp_number: '+919000000000' },
  dealInsertError: null,
  dealId: 'deal-1',
  itemsError: null,
  dealLinkUrl: 'https://rzp.io/l/combined',
  inserts: {},
}

/** Fluent query builder whose terminal result depends on (table, op). */
function makeBuilder(table: string) {
  let op = 'select'
  const b: Record<string, unknown> = {}
  b.select = () => b
  b.insert = (row: unknown) => {
    op = 'insert'
    ;(db.inserts[table] ||= []).push(row)
    return b
  }
  b.upsert = (row: unknown) => {
    op = 'upsert'
    ;(db.inserts[table] ||= []).push(row)
    return b
  }
  b.update = (_row: unknown) => {
    op = 'update'
    return b
  }
  b.eq = () => b
  b.not = () => b
  b.maybeSingle = () => {
    if (table === 'contacts') return Promise.resolve({ data: db.existingContact, error: null })
    if (table === 'deals')
      return Promise.resolve({ data: { razorpay_payment_link_url: db.dealLinkUrl }, error: null })
    return Promise.resolve({ data: null, error: null })
  }
  b.single = () => {
    if (table === 'leads') return Promise.resolve({ data: { id: db.leadId }, error: null })
    if (table === 'contacts') return Promise.resolve({ data: db.contactRow, error: null })
    if (table === 'deals')
      return Promise.resolve({
        data: db.dealInsertError ? null : { id: db.dealId },
        error: db.dealInsertError,
      })
    return Promise.resolve({ data: null, error: null })
  }
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
    const result =
      op === 'insert' && table === 'deal_items'
        ? { error: db.itemsError }
        : { data: null, error: null }
    return Promise.resolve(result).then(res, rej)
  }
  return b
}

const loadedMock = vi.fn()
const emitEventMock = vi.fn(async (..._args: unknown[]) => {})

vi.mock('server-only', () => ({}))

vi.mock('@/lib/env', () => ({
  getEnv: () => ({ NEXT_PUBLIC_CAPTCHA_ENABLED: 'false' }),
}))

vi.mock('@/lib/supabase/server', () => ({
  getServiceClient: () => ({ from: (table: string) => makeBuilder(table) }),
}))

vi.mock('@/features/forms/queries', () => ({
  getFormWithFields: (...args: unknown[]) => loadedMock(...args),
}))

vi.mock('@/features/ingest/bind', () => ({
  validateAnswers: () => ({ ok: true }),
  applyBindings: () => ({
    contact: { whatsapp_number: '+919000000000', name: 'Asha', email: null },
    lead: { state: '', source: null },
    storeOnly: {},
  }),
}))

vi.mock('@/features/ingest/rateLimit', () => ({
  checkRateLimit: () => true,
}))

vi.mock('@/features/ingest/captcha', () => ({
  verifyCaptcha: async () => true,
}))

vi.mock('@/features/crm/automation/entry', () => ({
  resolveEntryStage: async () => 'stage-1',
}))

vi.mock('@/features/crm/automation/runActions', () => ({
  runStageActions: async () => {},
}))

vi.mock('@/features/crm/activities/service', () => ({
  logActivity: async () => {},
}))

vi.mock('@/features/rbac/assignment', () => ({
  assignNext: async () => null,
}))

vi.mock('@/features/webhooks/emit', () => ({
  emitEvent: (...args: unknown[]) => emitEventMock(...args),
}))

import { POST } from './route'

/** Minimal non-taxable product (total = base_price; no GST env dependency). */
function product(id: string, name: string, base_price: number, active = true): Product {
  return {
    id,
    name,
    description: null,
    base_price,
    price_mode: 'exclusive',
    gst_percentage: 0,
    taxable: false,
    active,
    is_bundle: false,
    bundle_components: null,
    created_at: null,
    updated_at: null,
  } as unknown as Product
}

function makeReq(body: unknown): Request {
  return new Request('https://example.com/api/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify(body),
  })
}

const offered = [product('p1', 'Course A', 1000), product('p2', 'Course B', 500)]

beforeEach(() => {
  vi.clearAllMocks()
  db.existingContact = null
  db.dealInsertError = null
  db.itemsError = null
  db.dealLinkUrl = 'https://rzp.io/l/combined'
  db.inserts = {}
  loadedMock.mockResolvedValue({
    form: { id: 'form-1', status: 'published' },
    fields: [],
    product: offered[0],
    products: offered,
  })
})

describe('POST /api/ingest — multi-line order creation (WS6)', () => {
  it('a 2-item selection inserts ONE deal (product_id null, form_id set, aggregate totals) + TWO snapshotted items', async () => {
    const res = await POST(
      makeReq({ form_id: 'form-1', answers: {}, selected_products: ['p1', 'p2'] })
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { success: boolean; payment_link: string | null }
    expect(json.success).toBe(true)
    expect(json.payment_link).toBe('https://rzp.io/l/combined')

    // Exactly one deals row, product_id null, form_id set, totals aggregated.
    expect(db.inserts.deals).toHaveLength(1)
    const deal = db.inserts.deals[0] as Record<string, unknown>
    expect(deal.product_id).toBeNull()
    expect(deal.form_id).toBe('form-1')
    expect(deal.base_amount).toBe(1500)
    expect(deal.total_amount).toBe(1500)

    // Exactly one deal_items insert, carrying two snapshotted lines.
    expect(db.inserts.deal_items).toHaveLength(1)
    const items = db.inserts.deal_items[0] as Array<Record<string, unknown>>
    expect(items).toHaveLength(2)
    expect(items.map((it) => it.product_name)).toEqual(['Course A', 'Course B'])
    expect(items.map((it) => it.base_price)).toEqual([1000, 500])
    expect(items.every((it) => it.deal_id === 'deal-1')).toBe(true)

    // deal.created carries itemCount; neither event carries productId.
    expect(emitEventMock).toHaveBeenCalledWith(
      'deal.created',
      expect.objectContaining({ dealId: 'deal-1', itemCount: 2 })
    )
    const dealCreatedPayload = emitEventMock.mock.calls.find((c) => c[0] === 'deal.created')?.[1]
    expect(dealCreatedPayload).not.toHaveProperty('productId')
  })

  it('an empty selection → 400 and creates nothing', async () => {
    const res = await POST(makeReq({ form_id: 'form-1', answers: {}, selected_products: [] }))
    expect(res.status).toBe(400)
    expect(db.inserts.deals).toBeUndefined()
    expect(db.inserts.deal_items).toBeUndefined()
  })

  it('an id not offered is excluded; one valid + one bogus → a 1-line order', async () => {
    const res = await POST(
      makeReq({ form_id: 'form-1', answers: {}, selected_products: ['p1', 'not-offered'] })
    )
    expect(res.status).toBe(200)
    const items = db.inserts.deal_items[0] as Array<Record<string, unknown>>
    expect(items).toHaveLength(1)
    expect(items[0].product_name).toBe('Course A')
    expect((db.inserts.deals[0] as Record<string, unknown>).total_amount).toBe(1000)
  })

  it('an inactive offered product is excluded; all-invalid selection → 400', async () => {
    loadedMock.mockResolvedValue({
      form: { id: 'form-1', status: 'published' },
      fields: [],
      product: offered[0],
      products: [product('p1', 'Course A', 1000, false)],
    })
    const res = await POST(
      makeReq({ form_id: 'form-1', answers: {}, selected_products: ['p1', 'nope'] })
    )
    expect(res.status).toBe(400)
    expect(db.inserts.deals).toBeUndefined()
  })
})
