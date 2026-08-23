import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/env', () => ({ getEnv: () => ({ ALTCHA_HMAC_KEY: 'test-key-123' }) }))

import { createChallenge, solveChallenge } from 'altcha-lib/v1'
import { verifyCaptcha } from './captcha'

/**
 * Build a real solved Altcha payload the way the widget would: create a
 * challenge with `key`, brute-force the proof-of-work locally via
 * `solveChallenge`, then assemble + base64 the payload the browser posts.
 */
async function solvedPayload(key: string): Promise<string> {
  const ch = await createChallenge({ hmacKey: key, maxNumber: 1000 })
  const sol = await solveChallenge(ch.challenge, ch.salt, ch.algorithm, ch.maxnumber).promise
  const payload = {
    algorithm: ch.algorithm,
    challenge: ch.challenge,
    number: sol!.number,
    salt: ch.salt,
    signature: ch.signature,
  }
  return Buffer.from(JSON.stringify(payload)).toString('base64')
}

describe('verifyCaptcha (altcha)', () => {
  it('empty / null → false (fails closed)', async () => {
    expect(await verifyCaptcha('')).toBe(false)
    expect(await verifyCaptcha(null)).toBe(false)
    expect(await verifyCaptcha(undefined)).toBe(false)
  })

  it('valid solved payload → true', async () => {
    expect(await verifyCaptcha(await solvedPayload('test-key-123'))).toBe(true)
  })

  it('payload solved against a different key → false', async () => {
    expect(await verifyCaptcha(await solvedPayload('wrong-key'))).toBe(false)
  })

  it('garbage payload → false', async () => {
    expect(await verifyCaptcha('not-base64-!!')).toBe(false)
  })
})
