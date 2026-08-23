import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { signWebhook } from './sign'

/**
 * Unit tests for `signWebhook` (plan WS3 Step 1 / design §Delivery).
 *
 * `signWebhook` must return the hex-encoded HMAC-SHA256 of the raw body under
 * the given secret — the value the receiver recomputes to verify authenticity.
 */
describe('signWebhook (plan WS3)', () => {
  it('returns hex HMAC-SHA256 of the raw body under the secret (known vector)', () => {
    const secret = 'topsecret'
    const body = '{"dealId":"deal-1","amount":4999}'
    const expected = createHmac('sha256', secret).update(body).digest('hex')

    const sig = signWebhook(secret, body)

    expect(sig).toBe(expected)
    // 32-byte digest → 64 hex chars.
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic for the same secret + body', () => {
    const secret = 'k'
    const body = 'hello'
    expect(signWebhook(secret, body)).toBe(signWebhook(secret, body))
  })

  it('produces a different signature for a different body', () => {
    const secret = 'k'
    expect(signWebhook(secret, 'a')).not.toBe(signWebhook(secret, 'b'))
  })

  it('produces a different signature for a different secret', () => {
    const body = 'same-body'
    expect(signWebhook('secret-1', body)).not.toBe(signWebhook('secret-2', body))
  })
})
