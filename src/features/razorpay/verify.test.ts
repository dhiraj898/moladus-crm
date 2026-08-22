import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyRazorpaySignature } from './verify'

const SECRET = 'whsec_test_molecule'

/** Sign a body exactly as Razorpay does: HMAC-SHA256 hex over the raw body. */
function sign(body: string, secret = SECRET): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

describe('verifyRazorpaySignature', () => {
  const rawBody = JSON.stringify({
    event: 'payment_link.paid',
    payload: { payment_link: { entity: { id: 'plink_123' } } },
  })

  it('returns true for a valid signature over the raw body', () => {
    const signature = sign(rawBody)
    expect(verifyRazorpaySignature(rawBody, signature, SECRET)).toBe(true)
  })

  it('returns false when the body is tampered with', () => {
    const signature = sign(rawBody)
    const tampered = rawBody.replace('plink_123', 'plink_evil')
    expect(verifyRazorpaySignature(tampered, signature, SECRET)).toBe(false)
  })

  it('returns false when the signature was made with a different secret', () => {
    const signature = sign(rawBody, 'wrong_secret')
    expect(verifyRazorpaySignature(rawBody, signature, SECRET)).toBe(false)
  })

  it('returns false for a missing signature', () => {
    expect(verifyRazorpaySignature(rawBody, null, SECRET)).toBe(false)
    expect(verifyRazorpaySignature(rawBody, undefined, SECRET)).toBe(false)
    expect(verifyRazorpaySignature(rawBody, '', SECRET)).toBe(false)
  })

  it('returns false for a signature of the wrong length', () => {
    expect(verifyRazorpaySignature(rawBody, 'abc123', SECRET)).toBe(false)
  })
})
