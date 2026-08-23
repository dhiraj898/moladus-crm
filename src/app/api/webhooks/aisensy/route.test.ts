import crypto from 'node:crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for the signature-first AiSensy inbound webhook (Spec 6 design §5,
 * plan Task 3.1). Mirrors the durable Razorpay webhook contract:
 *   - 503 when AISENSY_WEBHOOK_SECRET is unset (checked FIRST, DB untouched).
 *   - 401 on a bad/missing signature, verified over the RAW body, DB untouched.
 *   - JSON is parsed only after the signature is trusted (400 on malformed).
 *   - Idempotent upsert on aisensy_message_id; direction derived from sender;
 *     phone normalized; contact resolved by phone.
 *   - Non-duplicate storage error → 500 so AiSensy retries.
 *
 * `@/features/integrations/secrets` is mocked through a mutable hoisted holder
 * so a single test can clear the secret and exercise the 503 fail-safe path.
 */

const SECRET = 'whsec_test_aisensy'

const { envState } = vi.hoisted(() => ({
  envState: { AISENSY_WEBHOOK_SECRET: undefined as string | undefined },
}))

// Chainable supabase mock: contacts.select(...).eq(...).order(...).limit(...).maybeSingle()
const maybeSingleMock = vi.fn(
  async (): Promise<{ data: { id: string } | null }> => ({ data: { id: 'contact-1' } }),
)
const upsertMock = vi.fn(
  async (
    _row: Record<string, unknown>,
    _opts: Record<string, unknown>,
  ): Promise<{ error: unknown }> => ({ error: null }),
)

function makeClient() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'messages') return { upsert: upsertMock }
      // contacts lookup
      return {
        select: () => ({
          eq: () => ({
            order: () => ({ limit: () => ({ maybeSingle: maybeSingleMock }) }),
          }),
        }),
      }
    }),
  }
}

vi.mock('@/features/integrations/secrets', () => ({
  getSecret: async () => envState.AISENSY_WEBHOOK_SECRET,
}))
vi.mock('@/lib/supabase/server', () => ({
  getServiceClient: () => makeClient(),
}))

import { POST } from './route'

function sign(body: string, secret = SECRET): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

function req(body: string, signature?: string | null): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (signature) headers['x-aisensy-signature'] = signature
  return new Request('https://app.test/api/webhooks/aisensy', {
    method: 'POST',
    headers,
    body,
  })
}

const inbound = JSON.stringify({
  topic: 'message.sender.user',
  data: {
    id: 'msg_1',
    sender: 'USER',
    message_type: 'text',
    body: 'hi',
    phone_number: '+91 98123 45678',
    sent_at: '2026-08-22T10:00:00Z',
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  envState.AISENSY_WEBHOOK_SECRET = SECRET
  maybeSingleMock.mockResolvedValue({ data: { id: 'contact-1' } })
  upsertMock.mockResolvedValue({ error: null })
})

describe('POST /api/webhooks/aisensy', () => {
  it('503s when AISENSY_WEBHOOK_SECRET is unset and never touches the DB', async () => {
    envState.AISENSY_WEBHOOK_SECRET = undefined
    const res = await POST(req(inbound, sign(inbound)))
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: 'webhook not configured' })
    expect(upsertMock).not.toHaveBeenCalled()
    expect(maybeSingleMock).not.toHaveBeenCalled()
  })

  it('401s on a missing signature and never touches the DB', async () => {
    const res = await POST(req(inbound))
    expect(res.status).toBe(401)
    expect(upsertMock).not.toHaveBeenCalled()
    expect(maybeSingleMock).not.toHaveBeenCalled()
  })

  it('401s on a bad signature and never touches the DB', async () => {
    const res = await POST(req(inbound, 'sha256=deadbeef'))
    expect(res.status).toBe(401)
    expect(upsertMock).not.toHaveBeenCalled()
    expect(maybeSingleMock).not.toHaveBeenCalled()
  })

  it('400s on malformed JSON after a valid signature, DB untouched', async () => {
    const notJson = 'not-json'
    const res = await POST(req(notJson, sign(notJson)))
    expect(res.status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('200s on a valid signature and upserts one message row', async () => {
    const res = await POST(req(inbound, sign(inbound)))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(upsertMock).toHaveBeenCalledTimes(1)
    const [row, opts] = upsertMock.mock.calls[0]
    expect(row).toMatchObject({
      aisensy_message_id: 'msg_1',
      direction: 'inbound',
      sender: 'USER',
      message_type: 'text',
      body: 'hi',
      phone_number: '919812345678', // normalized
      contact_id: 'contact-1',
      sent_at: '2026-08-22T10:00:00Z',
    })
    expect(opts).toMatchObject({ onConflict: 'aisensy_message_id', ignoreDuplicates: true })
  })

  it('classifies API/AGENT/SYSTEM senders as outbound', async () => {
    const outbound = JSON.stringify({
      topic: 'message.created',
      data: { id: 'msg_2', sender: 'API', body: 'template', phone_number: '919812345678' },
    })
    const res = await POST(req(outbound, sign(outbound)))
    expect(res.status).toBe(200)
    expect(upsertMock.mock.calls[0][0]).toMatchObject({ direction: 'outbound' })
  })

  it('stores contact_id null when no contact matches, keeping the phone', async () => {
    maybeSingleMock.mockResolvedValue({ data: null })
    const res = await POST(req(inbound, sign(inbound)))
    expect(res.status).toBe(200)
    expect(upsertMock.mock.calls[0][0]).toMatchObject({
      contact_id: null,
      phone_number: '919812345678',
    })
  })

  it('200s on a duplicate (ignoreDuplicates upsert returns no error)', async () => {
    const res = await POST(req(inbound, sign(inbound)))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })

  it('500s on a non-duplicate storage error so AiSensy retries', async () => {
    upsertMock.mockResolvedValue({ error: { message: 'db down' } })
    const res = await POST(req(inbound, sign(inbound)))
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'storage error' })
  })

  it('synthesizes a deterministic id when the provider omits one', async () => {
    const noId = JSON.stringify({
      topic: 'message.sender.user',
      data: {
        sender: 'USER',
        body: 'hi',
        phone_number: '919812345678',
        sent_at: '2026-08-22T10:00:00Z',
      },
    })
    const res = await POST(req(noId, sign(noId)))
    expect(res.status).toBe(200)
    const id = (upsertMock.mock.calls[0][0] as { aisensy_message_id: string }).aisensy_message_id
    expect(id).toMatch(/^2026-08-22T10:00:00Z:919812345678:[0-9a-f]{12}$/)
  })
})
