import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SlaRule } from '@/lib/supabase/types'

/**
 * Unit tests for the SLA scanner (plan Task 4.1 / design §5 + §8).
 *
 * The service-role client, the AiSensy send helper, the on-enter action runner,
 * and `logActivity` are all mocked so these run without a live DB or live keys.
 * The mock service client is configured per-test via the mutable `db` object:
 *   - `db.rules`        → active sla_rules
 *   - `db.deals`        → rows the `deals` scan query returns
 *   - `db.contact`      → contact row for send_whatsapp lookups
 *   - `db.product`      → product row for send_whatsapp lookups
 *   - `db.stages`       → stage rows for move_stage name resolution
 *   - `insertRunMock`   → controls the automation_runs guard insert result
 *   - `dealsEqCalls` / `dealsLteCalls` → capture the due-window query so
 *     "due-selection" can be asserted against a mocked client.
 */

const sendWhatsAppTemplateMock = vi.fn(async (_input: unknown) => ({ ok: true }))
const runStageActionsMock = vi.fn(async (_dealId: string, _stageId: string) => {})
const logActivityMock = vi.fn(async (..._args: unknown[]) => {})

const insertRunMock = vi.fn<(row: unknown) => Promise<{ error: unknown }>>()
const dealsUpdateEqMock = vi.fn(async () => ({ error: null }))
const dealStageEventInsertMock = vi.fn(async (_row: unknown) => ({ error: null }))
const dealsEqCalls: unknown[][] = []
const dealsLteCalls: unknown[][] = []

const db: {
  rules: SlaRule[]
  deals: unknown[]
  contact: unknown
  product: unknown
  stages: unknown[]
} = { rules: [], deals: [], contact: null, product: null, stages: [] }

/** A thenable + maybeSingle-terminal query builder returning a fixed result. */
function query(result: () => { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {}
  const chain = () => b
  b.select = chain
  b.eq = chain
  b.lte = chain
  b.in = chain
  b.order = chain
  b.maybeSingle = () => Promise.resolve(result())
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(result()).then(res, rej)
  return b
}

// `sla.ts` is `import 'server-only'`; neutralise that guard for the unit test.
vi.mock('server-only', () => ({}))

vi.mock('@/lib/supabase/server', () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      switch (table) {
        case 'sla_rules':
          return query(() => ({ data: db.rules, error: null }))
        case 'deals':
          return {
            // Scan query: records eq/lte so the due-window can be asserted.
            select: () => {
              const b: Record<string, unknown> = {}
              b.eq = (...args: unknown[]) => {
                dealsEqCalls.push(args)
                return b
              }
              b.lte = (...args: unknown[]) => {
                dealsLteCalls.push(args)
                return b
              }
              b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
                Promise.resolve({ data: db.deals, error: null }).then(res, rej)
              return b
            },
            // System move: update ... .eq(id)
            update: () => ({ eq: dealsUpdateEqMock }),
          }
        case 'automation_runs':
          return { insert: (row: unknown) => insertRunMock(row) }
        case 'contacts':
          return query(() => ({ data: db.contact, error: null }))
        case 'products':
          return query(() => ({ data: db.product, error: null }))
        case 'stages':
          return query(() => ({ data: db.stages, error: null }))
        case 'deal_stage_events':
          return { insert: dealStageEventInsertMock }
        default:
          throw new Error(`unexpected table: ${table}`)
      }
    },
  }),
}))

vi.mock('@/features/aisensy/send', () => ({
  sendWhatsAppTemplate: (input: unknown) => sendWhatsAppTemplateMock(input),
}))

vi.mock('./runActions', () => ({
  runStageActions: (dealId: string, stageId: string) => runStageActionsMock(dealId, stageId),
}))

vi.mock('@/features/crm/activities/service', () => ({
  logActivity: (...args: unknown[]) => logActivityMock(...args),
}))

import { scanDueSlaRules } from './sla'

const DAY_MIN = 1440

function slaRule(partial: Partial<SlaRule>): SlaRule {
  return {
    id: partial.id ?? 'rule-1',
    from_stage_id: partial.from_stage_id ?? 'stage-payment',
    delay_minutes: partial.delay_minutes ?? DAY_MIN,
    condition: partial.condition ?? null,
    action_type: partial.action_type ?? 'send_whatsapp',
    config: partial.config ?? { template: 'payment_reminder' },
    active: partial.active ?? true,
    created_at: '2026-08-22T00:00:00Z',
  }
}

/** A deal row that entered its stage `daysAgo` days ago. */
function deal(partial: Record<string, unknown>, daysAgo = 2) {
  return {
    id: 'deal-1',
    stage_id: 'stage-payment',
    stage_entered_at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    payment_status: 'link_sent',
    contact_id: 'contact-1',
    product_id: 'product-1',
    razorpay_payment_link_url: 'https://rzp.io/x',
    ...partial,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  dealsEqCalls.length = 0
  dealsLteCalls.length = 0
  db.rules = []
  db.deals = []
  db.contact = { name: 'Asha', whatsapp_number: '+919000000000' }
  db.product = { id: 'product-1', name: 'Course' }
  db.stages = [
    { id: 'stage-payment', name: 'Payment Link Sent' },
    { id: 'stage-lost', name: 'Closed Lost' },
  ]
  insertRunMock.mockResolvedValue({ error: null })
})

describe('scanDueSlaRules (plan Task 4.1)', () => {
  it('fires a due, matching, un-fired rule exactly once and dispatches send_whatsapp', async () => {
    db.rules = [
      slaRule({
        action_type: 'send_whatsapp',
        condition: { field: 'payment_status', op: 'neq', value: 'paid' },
        config: { template: 'payment_reminder' },
      }),
    ]
    db.deals = [deal({ payment_status: 'link_sent' })]

    const result = await scanDueSlaRules()

    expect(result).toEqual({ fired: 1 })
    // Guard row written before dispatch (at-most-once).
    expect(insertRunMock).toHaveBeenCalledTimes(1)
    expect(insertRunMock.mock.calls[0][0]).toMatchObject({
      deal_id: 'deal-1',
      sla_rule_id: 'rule-1',
    })
    // Dispatched the WhatsApp reminder, not a move.
    expect(sendWhatsAppTemplateMock).toHaveBeenCalledTimes(1)
    expect(sendWhatsAppTemplateMock.mock.calls[0][0]).toMatchObject({
      dealId: 'deal-1',
      template: 'payment_reminder',
      whatsapp: '+919000000000',
    })
    expect(runStageActionsMock).not.toHaveBeenCalled()
  })

  it('selects only the due window: scopes to from_stage and stage_entered_at <= now - delay', async () => {
    db.rules = [slaRule({ from_stage_id: 'stage-payment', delay_minutes: DAY_MIN })]
    db.deals = []

    const before = Date.now()
    await scanDueSlaRules()
    const after = Date.now()

    expect(dealsEqCalls).toContainEqual(['stage_id', 'stage-payment'])
    expect(dealsLteCalls).toHaveLength(1)
    const [field, cutoffIso] = dealsLteCalls[0] as [string, string]
    expect(field).toBe('stage_entered_at')
    const cutoff = Date.parse(cutoffIso)
    // Cutoff must be delay_minutes before "now" (bounded by the call window).
    expect(cutoff).toBeGreaterThanOrEqual(before - DAY_MIN * 60_000 - 5_000)
    expect(cutoff).toBeLessThanOrEqual(after - DAY_MIN * 60_000 + 5_000)
  })

  it('is at-most-once: a duplicate guard insert (unique violation) fires nothing', async () => {
    db.rules = [
      slaRule({ condition: { field: 'payment_status', op: 'neq', value: 'paid' } }),
    ]
    db.deals = [deal({ payment_status: 'link_sent' })]
    insertRunMock.mockResolvedValue({ error: { code: '23505' } })

    const result = await scanDueSlaRules()

    expect(result).toEqual({ fired: 0 })
    expect(sendWhatsAppTemplateMock).not.toHaveBeenCalled()
    expect(runStageActionsMock).not.toHaveBeenCalled()
  })

  it('skips a deal whose condition does not hold (already paid)', async () => {
    db.rules = [
      slaRule({ condition: { field: 'payment_status', op: 'neq', value: 'paid' } }),
    ]
    db.deals = [deal({ payment_status: 'paid' })]

    const result = await scanDueSlaRules()

    expect(result).toEqual({ fired: 0 })
    // No guard written, nothing dispatched.
    expect(insertRunMock).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplateMock).not.toHaveBeenCalled()
  })

  it('dispatches move_stage as a system actor and runs the destination on-enter actions', async () => {
    db.rules = [
      slaRule({
        action_type: 'move_stage',
        condition: { field: 'payment_status', op: 'neq', value: 'paid' },
        config: { to_stage_id: 'stage-lost' },
      }),
    ]
    db.deals = [deal({ payment_status: 'link_sent' })]

    const result = await scanDueSlaRules()

    expect(result).toEqual({ fired: 1 })
    // Moved the deal (system move reproduces changeDealStage's committed effects).
    expect(dealsUpdateEqMock).toHaveBeenCalledTimes(1)
    expect(dealStageEventInsertMock).toHaveBeenCalledTimes(1)
    expect(dealStageEventInsertMock.mock.calls[0][0]).toMatchObject({
      deal_id: 'deal-1',
      stage_id: 'stage-lost',
      actor_id: null,
    })
    // Destination on-enter actions run.
    expect(runStageActionsMock).toHaveBeenCalledWith('deal-1', 'stage-lost')
    // A move is not a WhatsApp send.
    expect(sendWhatsAppTemplateMock).not.toHaveBeenCalled()
  })

  it('counts the guard row even when dispatch fails, and logs the failure (no retry)', async () => {
    db.rules = [slaRule({ action_type: 'send_whatsapp', config: { template: 'payment_reminder' } })]
    db.deals = [deal({})]
    sendWhatsAppTemplateMock.mockRejectedValueOnce(new Error('AiSensy down'))

    const result = await scanDueSlaRules()

    // Fired (guard written); failure logged to the timeline, never auto-retried.
    expect(result).toEqual({ fired: 1 })
    expect(logActivityMock).toHaveBeenCalled()
  })
})
