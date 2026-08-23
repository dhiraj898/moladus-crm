import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { signWebhook } from './sign'

/**
 * Unit tests for `deliverDueWebhooks` (plan WS3 Step 2 / design §Delivery).
 *
 * `getServiceClient`, `decryptSecret`, and global `fetch` are mocked. The mock
 * delivery query faithfully applies the `status = 'pending'` and
 * `next_attempt_at <= now` predicates against `db.deliveries`, so the
 * due-selection case exercises the real selection predicate; `decryptSecret`
 * is mapped as `enc:<plain>` → `<plain>` so the signature can be recomputed.
 *
 * Covered: a due 2xx delivery → `delivered` + response_code + a single signed
 * POST; a 500 → attempts++ with the status held `pending` and `next_attempt_at`
 * pushed into the future (backoff); repeated failures until
 * `attempts >= max_attempts` → `failed`; a not-yet-due row is skipped.
 */

interface DeliveryRow {
  id: string
  endpoint_id: string
  event: string
  payload: Record<string, unknown>
  status: string
  attempts: number
  max_attempts: number
  next_attempt_at: string
  endpoint: { url: string; secret_enc: string; active: boolean } | null
}

const db: { deliveries: DeliveryRow[] } = { deliveries: [] }

/** Captured `update(patch).eq('id', id)` calls against webhook_deliveries. */
const updateCalls: { id: unknown; patch: Record<string, unknown> }[] = []

const fetchMock =
  vi.fn<(url: string, init: RequestInit) => Promise<{ status: number }>>()

/** Thenable delivery-query builder that applies the due-pending predicate. */
function deliveryQuery() {
  let statusFilter: string | undefined
  let dueCutoff: string | undefined
  const b: Record<string, unknown> = {}
  b.select = () => b
  b.eq = (col: string, val: unknown) => {
    if (col === 'status') statusFilter = val as string
    return b
  }
  b.lte = (col: string, val: unknown) => {
    if (col === 'next_attempt_at') dueCutoff = val as string
    return b
  }
  b.order = () => b
  b.limit = () => b
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
    const matched = db.deliveries.filter(
      (d) =>
        (statusFilter === undefined || d.status === statusFilter) &&
        (dueCutoff === undefined || d.next_attempt_at <= dueCutoff)
    )
    return Promise.resolve({ data: matched, error: null }).then(res, rej)
  }
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      if (table === 'webhook_deliveries') {
        return {
          ...deliveryQuery(),
          update: (patch: Record<string, unknown>) => ({
            eq: (_col: string, id: unknown) => {
              updateCalls.push({ id, patch })
              // Reflect the patch back into the in-memory row so multi-pass
              // tests (retry → failed) observe the accumulated state.
              const row = db.deliveries.find((d) => d.id === id)
              if (row) Object.assign(row, patch)
              return Promise.resolve({ error: null })
            },
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

vi.mock('@/features/integrations/crypto', () => ({
  // Mirror the `enc:<plain>` fixture convention used by the delivery rows.
  decryptSecret: (enc: string) => enc.replace(/^enc:/, ''),
}))

import { deliverDueWebhooks } from './deliver'

function delivery(partial: Partial<DeliveryRow>): DeliveryRow {
  return {
    id: partial.id ?? 'del-1',
    endpoint_id: partial.endpoint_id ?? 'ep-1',
    event: partial.event ?? 'deal.paid',
    payload: partial.payload ?? { dealId: 'deal-1' },
    status: partial.status ?? 'pending',
    attempts: partial.attempts ?? 0,
    max_attempts: partial.max_attempts ?? 5,
    next_attempt_at: partial.next_attempt_at ?? new Date(Date.now() - 1000).toISOString(),
    endpoint: partial.endpoint ?? {
      url: 'https://receiver.test/hook',
      secret_enc: 'enc:s3cr3t',
      active: true,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.deliveries = []
  updateCalls.length = 0
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('deliverDueWebhooks (plan WS3)', () => {
  it('delivers a due pending row on 2xx: status delivered, response_code, one signed POST', async () => {
    db.deliveries = [delivery({ id: 'del-ok', payload: { dealId: 'deal-1', amount: 4999 } })]
    fetchMock.mockResolvedValue({ status: 200 })

    const result = await deliverDueWebhooks()

    expect(result).toEqual({ delivered: 1, failed: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://receiver.test/hook')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['X-Moladus-Event']).toBe('deal.paid')
    expect(headers['X-Moladus-Delivery']).toBe('del-ok')

    // Signature is sha256=<hmac(secret, rawBody)> over the exact body sent.
    const rawBody = init.body as string
    expect(rawBody).toBe(JSON.stringify({ dealId: 'deal-1', amount: 4999 }))
    expect(headers['X-Moladus-Signature']).toBe(`sha256=${signWebhook('s3cr3t', rawBody)}`)

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].id).toBe('del-ok')
    expect(updateCalls[0].patch.status).toBe('delivered')
    expect(updateCalls[0].patch.response_code).toBe(200)
  })

  it('on a 500, increments attempts, holds status pending, and backs off into the future', async () => {
    db.deliveries = [delivery({ id: 'del-retry', attempts: 0, max_attempts: 5 })]
    fetchMock.mockResolvedValue({ status: 500 })

    const before = Date.now()
    const result = await deliverDueWebhooks()

    expect(result).toEqual({ delivered: 0, failed: 0 })
    expect(updateCalls).toHaveLength(1)
    const patch = updateCalls[0].patch
    expect(patch.status).toBe('pending')
    expect(patch.attempts).toBe(1)
    expect(patch.response_code).toBe(500)
    // next_attempt_at is pushed into the future (first backoff step).
    const next = Date.parse(patch.next_attempt_at as string)
    expect(next).toBeGreaterThan(before)
  })

  it('flips to failed once attempts reach max_attempts', async () => {
    // One attempt away from the ceiling; a failure tips it over.
    db.deliveries = [delivery({ id: 'del-last', attempts: 4, max_attempts: 5 })]
    fetchMock.mockResolvedValue({ status: 503 })

    const result = await deliverDueWebhooks()

    expect(result).toEqual({ delivered: 0, failed: 1 })
    expect(updateCalls).toHaveLength(1)
    const patch = updateCalls[0].patch
    expect(patch.status).toBe('failed')
    expect(patch.attempts).toBe(5)
  })

  it('skips a delivery that is not yet due (next_attempt_at in the future)', async () => {
    db.deliveries = [
      delivery({
        id: 'del-future',
        next_attempt_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    ]
    fetchMock.mockResolvedValue({ status: 200 })

    const result = await deliverDueWebhooks()

    expect(result).toEqual({ delivered: 0, failed: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(updateCalls).toHaveLength(0)
  })

  it('retries across passes until it fails at max_attempts', async () => {
    db.deliveries = [delivery({ id: 'del-loop', attempts: 0, max_attempts: 3 })]
    fetchMock.mockResolvedValue({ status: 500 })

    // Force each stored row back to "due" so successive passes re-process it.
    const runPass = async () => {
      for (const d of db.deliveries) d.next_attempt_at = new Date(Date.now() - 1000).toISOString()
      return deliverDueWebhooks()
    }

    expect(await runPass()).toEqual({ delivered: 0, failed: 0 }) // attempts 1
    expect(await runPass()).toEqual({ delivered: 0, failed: 0 }) // attempts 2
    expect(await runPass()).toEqual({ delivered: 0, failed: 1 }) // attempts 3 → failed

    expect(db.deliveries[0].status).toBe('failed')
    expect(db.deliveries[0].attempts).toBe(3)
  })

  it('counts a thrown fetch (network error) as a retry, storing the error', async () => {
    db.deliveries = [delivery({ id: 'del-net', attempts: 0, max_attempts: 5 })]
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await deliverDueWebhooks()

    expect(result).toEqual({ delivered: 0, failed: 0 })
    expect(updateCalls).toHaveLength(1)
    const patch = updateCalls[0].patch
    expect(patch.status).toBe('pending')
    expect(patch.attempts).toBe(1)
    expect(patch.error).toContain('ECONNREFUSED')
  })
})
