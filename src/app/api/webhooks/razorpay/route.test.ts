import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for the Razorpay webhook route (plan Task 1.2 / spec §8, §11).
 *
 * getSecret, the signature check, the service-role client, `logActivity`,
 * `emitEvent`, and the system stage-move helper are all mocked so these run
 * without a live DB or live keys. The mock client is configured per-test via the
 * mutable `db` object.
 *
 * Coverage: 503 (secret unset), 400 (invalid signature / invalid JSON), 200 on a
 * genuine `paid` transition — asserting the deal is auto-moved to the Enrolled
 * stage and NO hardcoded receipt is sent — and idempotency (a duplicate already
 * processed short-circuits to 200 with no move). This route has no 401 path
 * (auth is by HMAC signature → 400 on failure).
 */

const getSecretMock = vi.fn<(key: string) => Promise<string | undefined>>()
const verifySignatureMock = vi.fn<() => boolean>()
const moveDealStageAsSystemMock = vi.fn(async (..._args: unknown[]) => {})
const logActivityMock = vi.fn(async (..._args: unknown[]) => {})
const emitEventMock = vi.fn(async (..._args: unknown[]) => {})
// The webhook no longer imports the AiSensy send helpers; mock the module and
// assert nothing is ever called through it (no hardcoded enrollment_receipt).
const sendWhatsAppTemplateMock = vi.fn(async () => ({ ok: true }))

const db: {
  insertError: unknown
  existingProcessed: { processed: boolean } | null
  deal: unknown
  transitioned: unknown[]
  enrolledStage: { id: string } | null
} = {
  insertError: null,
  existingProcessed: null,
  deal: null,
  transitioned: [],
  enrolledStage: { id: 'stage-enrolled' },
}

/** Fluent query builder whose terminal result depends on (table, op). */
function makeBuilder(table: string) {
  let op = 'select'
  const b: Record<string, unknown> = {}
  const chain = () => b
  b.select = () => {
    // deals.update(...).select('id') marks a transition read.
    if (op !== 'update') op = 'select'
    return b
  }
  b.insert = (_row: unknown) => {
    op = 'insert'
    return b
  }
  b.update = (_row: unknown) => {
    op = 'update'
    return b
  }
  b.eq = chain
  b.neq = chain
  b.limit = chain
  b.maybeSingle = () => {
    if (table === 'webhook_events') return Promise.resolve({ data: db.existingProcessed, error: null })
    if (table === 'deals') return Promise.resolve({ data: db.deal, error: null })
    if (table === 'stages') return Promise.resolve({ data: db.enrolledStage, error: null })
    return Promise.resolve({ data: null, error: null })
  }
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
    let result: unknown
    if (op === 'insert' && table === 'webhook_events') {
      result = { error: db.insertError }
    } else if (op === 'update' && table === 'deals') {
      result = { data: db.transitioned, error: null }
    } else if (op === 'update' && table === 'webhook_events') {
      result = { error: null }
    } else {
      result = { data: null, error: null }
    }
    return Promise.resolve(result).then(res, rej)
  }
  return b
}

vi.mock('server-only', () => ({}))

vi.mock('@/features/integrations/secrets', () => ({
  getSecret: (key: string) => getSecretMock(key),
}))

vi.mock('@/features/razorpay/verify', () => ({
  verifyRazorpaySignature: () => verifySignatureMock(),
}))

vi.mock('@/lib/supabase/server', () => ({
  getServiceClient: () => ({ from: (table: string) => makeBuilder(table) }),
}))

vi.mock('@/features/crm/automation/moveStage', () => ({
  moveDealStageAsSystem: (...args: unknown[]) => moveDealStageAsSystemMock(...args),
}))

vi.mock('@/features/crm/activities/service', () => ({
  logActivity: (...args: unknown[]) => logActivityMock(...args),
}))

vi.mock('@/features/webhooks/emit', () => ({
  emitEvent: (...args: unknown[]) => emitEventMock(...args),
}))

vi.mock('@/features/aisensy/send', () => ({
  sendWhatsAppTemplate: (...args: unknown[]) => sendWhatsAppTemplateMock(...(args as [])),
}))

import { POST } from './route'

function makeReq(
  body: unknown,
  headers: Record<string, string> = {}
): Request {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  return new Request('https://example.com/api/webhooks/razorpay', {
    method: 'POST',
    headers: {
      'x-razorpay-signature': 'sig',
      'x-razorpay-event-id': 'evt-1',
      ...headers,
    },
    body: raw,
  })
}

const paidBody = {
  event: 'payment_link.paid',
  payload: {
    payment_link: { entity: { id: 'plink-1' } },
    payment: { entity: { id: 'pay-1' } },
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  getSecretMock.mockResolvedValue('whsecret')
  verifySignatureMock.mockReturnValue(true)
  db.insertError = null
  db.existingProcessed = null
  db.deal = { id: 'deal-1', total_amount: '1000.00' }
  db.transitioned = [{ id: 'deal-1' }]
  db.enrolledStage = { id: 'stage-enrolled' }
})

describe('POST /api/webhooks/razorpay (plan Task 1.2)', () => {
  it('returns 503 when the webhook secret is not configured', async () => {
    getSecretMock.mockResolvedValueOnce(undefined)
    const res = await POST(makeReq(paidBody))
    expect(res.status).toBe(503)
    expect(moveDealStageAsSystemMock).not.toHaveBeenCalled()
  })

  it('returns 400 on an invalid signature and processes nothing', async () => {
    verifySignatureMock.mockReturnValue(false)
    const res = await POST(makeReq(paidBody))
    expect(res.status).toBe(400)
    expect(moveDealStageAsSystemMock).not.toHaveBeenCalled()
  })

  it('returns 400 on invalid JSON body', async () => {
    const res = await POST(makeReq('not-json{'))
    expect(res.status).toBe(400)
  })

  it('on a genuine paid transition, auto-moves the deal to Enrolled and sends no receipt', async () => {
    const res = await POST(makeReq(paidBody))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean }
    expect(json.ok).toBe(true)

    // Deal auto-moved to the resolved Enrolled stage, via 'payment'.
    expect(moveDealStageAsSystemMock).toHaveBeenCalledTimes(1)
    expect(moveDealStageAsSystemMock).toHaveBeenCalledWith('deal-1', 'stage-enrolled', {
      via: 'payment',
    })

    // Payment activity + outbound event still fire on the genuine transition.
    expect(logActivityMock).toHaveBeenCalledWith(
      'deal',
      'deal-1',
      'payment',
      expect.objectContaining({ metadata: expect.objectContaining({ status: 'paid' }) })
    )
    expect(emitEventMock).toHaveBeenCalledWith('deal.paid', expect.objectContaining({ dealId: 'deal-1' }))

    // No hardcoded enrollment_receipt send — confirmation is the Enrolled on-enter action.
    expect(sendWhatsAppTemplateMock).not.toHaveBeenCalled()
  })

  it('does not move when the paid update is a no-op (no genuine transition)', async () => {
    db.transitioned = []
    const res = await POST(makeReq(paidBody))
    expect(res.status).toBe(200)
    expect(moveDealStageAsSystemMock).not.toHaveBeenCalled()
    expect(emitEventMock).not.toHaveBeenCalled()
  })

  it('is idempotent: a duplicate already-processed event short-circuits to 200 with no move', async () => {
    db.insertError = { code: '23505' }
    db.existingProcessed = { processed: true }
    const res = await POST(makeReq(paidBody))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { duplicate?: boolean }
    expect(json.duplicate).toBe(true)
    expect(moveDealStageAsSystemMock).not.toHaveBeenCalled()
  })
})
