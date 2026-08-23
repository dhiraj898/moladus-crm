import { createChallenge } from 'altcha-lib/v1'
import { getEnv } from '@/lib/env'

/**
 * Altcha challenge endpoint (design §Architecture 1).
 *
 * `GET /api/altcha/challenge` mints a fresh HMAC-signed proof-of-work challenge
 * for the `<altcha-widget challengeurl="/api/altcha/challenge">` on the public
 * form. Verification is stateless: the widget solves the challenge and posts the
 * base64 payload as `captcha_token`, which `verifyCaptcha` re-checks against the
 * same server-only `ALTCHA_HMAC_KEY` — no challenge store, no external service.
 *
 * `Cache-Control: no-store` so every load gets a unique challenge (a cached
 * challenge could be replayed within its window). Short 10-minute expiry +
 * `checkExpires` on verify + the ingest dedupe bound replay.
 *
 * Node runtime: the challenge is signed with `node:crypto` via altcha-lib.
 */
export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  const challenge = await createChallenge({
    hmacKey: getEnv().ALTCHA_HMAC_KEY,
    maxNumber: 100_000,
    expires: new Date(Date.now() + 10 * 60_000),
  })
  return Response.json(challenge, { headers: { 'Cache-Control': 'no-store' } })
}
