import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyAiSensySignature } from './verify'

const SECRET = 'whsec_test_aisensy'

/** Sign a body as AiSensy does: HMAC-SHA256 hex over the raw body. */
function sign(body: string, secret = SECRET): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

describe('verifyAiSensySignature', () => {
  const rawBody = JSON.stringify({
    topic: 'message.created',
    data: { id: 'msg_123', sender: 'USER', phone_number: '919812345678' },
  })

  it('returns true for a valid signature over the raw body', () => {
    expect(verifyAiSensySignature(rawBody, sign(rawBody), SECRET)).toBe(true)
  })

  it('accepts an optional sha256= prefix', () => {
    expect(verifyAiSensySignature(rawBody, `sha256=${sign(rawBody)}`, SECRET)).toBe(true)
  })

  it('returns false when the body is tampered with', () => {
    const signature = sign(rawBody)
    const tampered = rawBody.replace('msg_123', 'msg_evil')
    expect(verifyAiSensySignature(tampered, signature, SECRET)).toBe(false)
  })

  it('returns false for a signature made with a different secret', () => {
    expect(verifyAiSensySignature(rawBody, sign(rawBody, 'wrong'), SECRET)).toBe(false)
  })

  it('returns false for a missing signature', () => {
    expect(verifyAiSensySignature(rawBody, null, SECRET)).toBe(false)
    expect(verifyAiSensySignature(rawBody, undefined, SECRET)).toBe(false)
    expect(verifyAiSensySignature(rawBody, '', SECRET)).toBe(false)
  })

  it('returns false for a signature of the wrong length', () => {
    expect(verifyAiSensySignature(rawBody, 'abc123', SECRET)).toBe(false)
  })
})
