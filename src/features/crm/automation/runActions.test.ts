import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StageAction } from '@/lib/supabase/types'

/**
 * Unit tests for the on-enter action runner (plan WS7 Task 7.1).
 *
 * Focus: an order-level deal (null `product_id`, lines in `deal_items`) must get
 * a payment link whose description summarises the lines — the runner must NOT
 * bail on a missing product. Supabase, Razorpay, AiSensy and logActivity are
 * mocked so this runs without a live DB or keys. The mutable `db` object feeds
 * the mock client per-test.
 */

const createPaymentLinkMock = vi.fn(async (_input: unknown) => ({
  id: 'plink_1',
  short_url: 'https://rzp.io/i/abc',
}))
const sendWhatsAppTemplateMock = vi.fn(async (_input: unknown) => ({ ok: true }))
const logActivityMock = vi.fn(async (..._args: unknown[]) => {})
const dealsUpdateMock = vi.fn(async (_row: unknown) => ({ error: null }))

const db: {
  stageActions: StageAction[]
  deal: unknown
  contact: unknown
  product: unknown
  dealItems: { product_name: string }[]
} = { stageActions: [], deal: null, contact: null, product: null, dealItems: [] }

/** A thenable + maybeSingle-terminal query builder returning a fixed result. */
function query(result: () => { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {}
  const chain = () => b
  b.select = chain
  b.eq = chain
  b.order = chain
  b.maybeSingle = () => Promise.resolve(result())
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(result()).then(res, rej)
  return b
}

vi.mock('server-only', () => ({}))

vi.mock('@/lib/supabase/server', () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      switch (table) {
        case 'stage_actions':
          return query(() => ({ data: db.stageActions, error: null }))
        case 'deals':
          return {
            ...query(() => ({ data: db.deal, error: null })),
            update: (row: unknown) => ({ eq: () => dealsUpdateMock(row) }),
          }
        case 'contacts':
          return query(() => ({ data: db.contact, error: null }))
        case 'products':
          return query(() => ({ data: db.product, error: null }))
        case 'deal_items':
          return query(() => ({ data: db.dealItems, error: null }))
        case 'leads':
          return query(() => ({ data: null, error: null }))
        case 'forms':
          return query(() => ({ data: null, error: null }))
        default:
          return query(() => ({ data: null, error: null }))
      }
    },
  }),
}))

vi.mock('@/features/razorpay/paymentLink', () => ({
  createPaymentLink: (input: unknown) => createPaymentLinkMock(input),
}))

vi.mock('@/features/aisensy/send', () => ({
  sendWhatsAppTemplate: (input: unknown) => sendWhatsAppTemplateMock(input),
}))

vi.mock('@/features/crm/activities/service', () => ({
  logActivity: (...args: unknown[]) => logActivityMock(...args),
}))

vi.mock('@/lib/env', () => ({
  getEnv: () => ({ NEXT_PUBLIC_APP_URL: 'https://app.test' }),
}))

import { runStageActions } from './runActions'

const CREATE_LINK_ACTION: StageAction = {
  id: 'sa_1',
  stage_id: 'stage_1',
  action_type: 'create_payment_link',
  config: {},
  run_order: 1,
  active: true,
  created_at: null,
} as unknown as StageAction

beforeEach(() => {
  vi.clearAllMocks()
  db.stageActions = [CREATE_LINK_ACTION]
  db.deal = {
    id: 'deal_1',
    lead_id: null,
    contact_id: 'contact_1',
    product_id: null,
    total_amount: 2360,
    razorpay_payment_link_url: null,
  }
  db.contact = { name: 'Asha', email: 'a@test.com', whatsapp_number: '+919000000000' }
  db.product = null
  db.dealItems = [{ product_name: 'Course A' }, { product_name: 'Course B' }]
})

describe('runStageActions — order-level create_payment_link', () => {
  it('mints a link with a non-empty line summary and does NOT bail on null product', async () => {
    await runStageActions('deal_1', 'stage_1')

    expect(createPaymentLinkMock).toHaveBeenCalledTimes(1)
    const arg = createPaymentLinkMock.mock.calls[0][0] as { description: string; amountPaise: number }
    expect(arg.description).toBe('Course A, Course B')
    expect(arg.description.length).toBeGreaterThan(0)
    expect(arg.amountPaise).toBe(236000)
    expect(dealsUpdateMock).toHaveBeenCalledTimes(1)
  })

  it('summarises three or more lines as "A, B, +N more"', async () => {
    db.dealItems = [
      { product_name: 'Course A' },
      { product_name: 'Course B' },
      { product_name: 'Course C' },
    ]

    await runStageActions('deal_1', 'stage_1')

    const arg = createPaymentLinkMock.mock.calls[0][0] as { description: string }
    expect(arg.description).toBe('Course A, Course B, +1 more')
  })

  it('falls back to the single product name for a legacy deal', async () => {
    db.deal = {
      id: 'deal_1',
      lead_id: null,
      contact_id: 'contact_1',
      product_id: 'prod_1',
      total_amount: 1000,
      razorpay_payment_link_url: null,
    }
    db.product = { name: 'Legacy Course' }
    db.dealItems = []

    await runStageActions('deal_1', 'stage_1')

    const arg = createPaymentLinkMock.mock.calls[0][0] as { description: string }
    expect(arg.description).toBe('Legacy Course')
  })
})
