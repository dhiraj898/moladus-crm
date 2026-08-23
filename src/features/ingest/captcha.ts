import 'server-only'
import { verifySolution } from 'altcha-lib/v1'
import { getEnv } from '@/lib/env'

/**
 * Server-side Altcha verification for the ingest endpoint (spec §6 step 2).
 *
 * The public form renders `<altcha-widget challengeurl="/api/altcha/challenge">`,
 * which solves an HMAC-signed proof-of-work challenge and posts the base64
 * payload as `captcha_token`. We re-verify it here against the same server-only
 * `ALTCHA_HMAC_KEY` via `verifySolution` — stateless, no challenge store and no
 * external service call. The key NEVER reaches the browser (this module is
 * `server-only`; the widget needs only the challenge URL).
 *
 * `verifySolution(payload, key, true)` checks the HMAC signature (proving the
 * challenge is one we issued), the proof-of-work number, and — with the third
 * `checkExpires` arg `true` — the challenge's expiry. Any empty payload, tamper,
 * wrong key, expiry, or parse error resolves to `false` — verification fails
 * closed.
 *
 * ENV-PENDING: a live pass/fail requires `ALTCHA_HMAC_KEY` set (and
 * `NEXT_PUBLIC_CAPTCHA_ENABLED=true` to enforce). Manual test once set: load the
 * form → the widget solves → submit → 200; tamper/omit `captcha_token` → ingest
 * returns 400 "captcha verification failed".
 */

/**
 * Verify an Altcha proof-of-work payload. Returns `true` only when the solution
 * verifies against `ALTCHA_HMAC_KEY`; fails closed (`false`) on any error or
 * empty payload.
 */
export async function verifyCaptcha(payload: string | null | undefined): Promise<boolean> {
  if (!payload) return false

  try {
    return await verifySolution(payload, getEnv().ALTCHA_HMAC_KEY, true)
  } catch {
    return false
  }
}
