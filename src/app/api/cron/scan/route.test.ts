import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for the secured cron scan route (plan Task 4.2 / design §6).
 *
 * `getEnv`, the SLA scanner, and the webhook delivery worker are mocked. The
 * route authorizes with a timing-safe compare of the `Authorization` header
 * against `Bearer ${CRON_SECRET}`: 401 when the header is absent or wrong, 200
 * with `{fired, delivered, failed}` — running BOTH jobs — when it matches.
 */

const scanDueSlaRulesMock = vi.fn(async () => ({ fired: 3 }))
const deliverDueWebhooksMock = vi.fn(async () => ({ delivered: 2, failed: 1 }))

vi.mock('@/lib/env', () => ({
  getEnv: () => ({ CRON_SECRET: 'super-secret' }),
}))

vi.mock('@/features/crm/automation/sla', () => ({
  scanDueSlaRules: () => scanDueSlaRulesMock(),
}))

vi.mock('@/features/webhooks/deliver', () => ({
  deliverDueWebhooks: () => deliverDueWebhooksMock(),
}))

import { GET, POST } from './route'

function req(auth?: string): Request {
  return new Request('https://app.test/api/cron/scan', {
    headers: auth ? { Authorization: auth } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET/POST /api/cron/scan (plan Task 4.2)', () => {
  it('401s with no Authorization header and does not run any job', async () => {
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(scanDueSlaRulesMock).not.toHaveBeenCalled()
    expect(deliverDueWebhooksMock).not.toHaveBeenCalled()
  })

  it('401s with a wrong bearer token', async () => {
    const res = await GET(req('Bearer wrong-secret'))
    expect(res.status).toBe(401)
    expect(scanDueSlaRulesMock).not.toHaveBeenCalled()
    expect(deliverDueWebhooksMock).not.toHaveBeenCalled()
  })

  it('401s with a malformed (non-Bearer) header', async () => {
    const res = await GET(req('super-secret'))
    expect(res.status).toBe(401)
    expect(scanDueSlaRulesMock).not.toHaveBeenCalled()
    expect(deliverDueWebhooksMock).not.toHaveBeenCalled()
  })

  it('200s with {fired, delivered, failed} for the correct bearer token', async () => {
    const res = await GET(req('Bearer super-secret'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ fired: 3, delivered: 2, failed: 1 })
    expect(scanDueSlaRulesMock).toHaveBeenCalledTimes(1)
    expect(deliverDueWebhooksMock).toHaveBeenCalledTimes(1)
  })

  it('accepts POST as well (for schedulers that POST)', async () => {
    const res = await POST(req('Bearer super-secret'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ fired: 3, delivered: 2, failed: 1 })
  })
})
