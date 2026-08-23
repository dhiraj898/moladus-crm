import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WebhookEvent } from './events'

/**
 * Unit tests for `emitEvent` (plan WS2 / design §Emit).
 *
 * The service-role client is mocked. `emitEvent` must:
 *   - enqueue exactly ONE `webhook_deliveries` row (status pending,
 *     next_attempt_at ≈ now) per ACTIVE endpoint subscribed to the event;
 *   - enqueue NOTHING for inactive or unsubscribed endpoints;
 *   - be best-effort — a DB error (lookup or insert) is swallowed, never thrown.
 *
 * The mock endpoint query faithfully applies the `active = true` +
 * `events @> [event]` filters against `db.endpoints`, so the "subscribed vs not"
 * and "inactive" cases exercise the real selection predicate.
 */

interface EndpointRow {
  id: string
  active: boolean
  events: WebhookEvent[]
}

const db: {
  endpoints: EndpointRow[]
  selectError: unknown
} = { endpoints: [], selectError: null }

const insertMock = vi.fn<(rows: unknown) => Promise<{ error: unknown }>>()

/** Thenable builder for the endpoint lookup that applies the real filters. */
function endpointQuery() {
  let activeFilter: boolean | undefined
  let eventFilter: string | undefined
  const b: Record<string, unknown> = {}
  b.select = () => b
  b.eq = (col: string, val: unknown) => {
    if (col === 'active') activeFilter = val as boolean
    return b
  }
  b.contains = (col: string, arr: unknown) => {
    if (col === 'events') eventFilter = (arr as string[])[0]
    return b
  }
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
    if (db.selectError) {
      return Promise.resolve({ data: null, error: db.selectError }).then(res, rej)
    }
    const matched = db.endpoints
      .filter(
        (e) =>
          (activeFilter === undefined || e.active === activeFilter) &&
          (eventFilter === undefined || e.events.includes(eventFilter as WebhookEvent))
      )
      .map((e) => ({ id: e.id }))
    return Promise.resolve({ data: matched, error: null }).then(res, rej)
  }
  return b
}

// `emit.ts` is `import 'server-only'`; neutralise that guard for the unit test.
vi.mock('server-only', () => ({}))

vi.mock('@/lib/supabase/server', () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      if (table === 'webhook_endpoints') return endpointQuery()
      if (table === 'webhook_deliveries') return { insert: insertMock }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

import { emitEvent } from './emit'

beforeEach(() => {
  vi.clearAllMocks()
  db.endpoints = []
  db.selectError = null
  insertMock.mockResolvedValue({ error: null })
})

describe('emitEvent (plan WS2)', () => {
  it('enqueues exactly one delivery for the single subscribed active endpoint', async () => {
    db.endpoints = [
      { id: 'ep-sub', active: true, events: ['deal.paid', 'deal.created'] },
      { id: 'ep-other', active: true, events: ['contact.created'] },
    ]

    const before = Date.now()
    await emitEvent('deal.paid', { dealId: 'deal-1', amount: 4999 })
    const after = Date.now()

    expect(insertMock).toHaveBeenCalledTimes(1)
    const rows = insertMock.mock.calls[0][0] as Record<string, unknown>[]
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.endpoint_id).toBe('ep-sub')
    expect(row.event).toBe('deal.paid')
    expect(row.status).toBe('pending')
    expect(row.payload).toEqual({ dealId: 'deal-1', amount: 4999 })
    // next_attempt_at ≈ now.
    const due = Date.parse(row.next_attempt_at as string)
    expect(due).toBeGreaterThanOrEqual(before - 5_000)
    expect(due).toBeLessThanOrEqual(after + 5_000)
  })

  it('enqueues one row per endpoint when several are subscribed', async () => {
    db.endpoints = [
      { id: 'ep-a', active: true, events: ['deal.created'] },
      { id: 'ep-b', active: true, events: ['deal.created', 'deal.paid'] },
    ]

    await emitEvent('deal.created', { dealId: 'deal-9' })

    expect(insertMock).toHaveBeenCalledTimes(1)
    const rows = insertMock.mock.calls[0][0] as Record<string, unknown>[]
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.endpoint_id).sort()).toEqual(['ep-a', 'ep-b'])
  })

  it('enqueues nothing when the only endpoint is not subscribed to the event', async () => {
    db.endpoints = [{ id: 'ep-1', active: true, events: ['contact.created'] }]

    await emitEvent('deal.paid', { dealId: 'deal-1' })

    expect(insertMock).not.toHaveBeenCalled()
  })

  it('ignores inactive endpoints even when subscribed', async () => {
    db.endpoints = [{ id: 'ep-off', active: false, events: ['deal.paid'] }]

    await emitEvent('deal.paid', { dealId: 'deal-1' })

    expect(insertMock).not.toHaveBeenCalled()
  })

  it('swallows a lookup error (never throws, never inserts)', async () => {
    db.selectError = { message: 'connection reset' }

    await expect(
      emitEvent('deal.paid', { dealId: 'deal-1' })
    ).resolves.toBeUndefined()
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('swallows an insert error (never throws)', async () => {
    db.endpoints = [{ id: 'ep-sub', active: true, events: ['deal.paid'] }]
    insertMock.mockResolvedValue({ error: { message: 'insert failed' } })

    await expect(
      emitEvent('deal.paid', { dealId: 'deal-1' })
    ).resolves.toBeUndefined()
  })

  it('swallows a thrown client (never throws)', async () => {
    db.endpoints = [{ id: 'ep-sub', active: true, events: ['deal.paid'] }]
    insertMock.mockRejectedValue(new Error('network down'))

    await expect(
      emitEvent('deal.paid', { dealId: 'deal-1' })
    ).resolves.toBeUndefined()
  })
})
