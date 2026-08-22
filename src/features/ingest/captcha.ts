import 'server-only'
import { getEnv } from '@/lib/env'

/**
 * Server-side hCaptcha verification for the ingest endpoint (spec §6 step 2).
 *
 * The public form renders the hCaptcha widget with the site key and posts the
 * resulting token to the ingest endpoint; we exchange it here for a pass/fail
 * against the hCaptcha siteverify API using the server-only `HCAPTCHA_SECRET`.
 * The secret NEVER reaches the browser (this module is `server-only`).
 *
 * Any missing token, non-2xx response, network error, or `success:false`
 * payload resolves to `false` — verification fails closed.
 *
 * ENV-PENDING: a live pass/fail requires `HCAPTCHA_SECRET` (and a matching
 * `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` on the form). Manual test once keys exist:
 * submit the form with a solved challenge → 200; tamper the token or omit it →
 * ingest returns 400 "captcha verification failed".
 */

const HCAPTCHA_VERIFY_URL = 'https://hcaptcha.com/siteverify'

interface HCaptchaVerifyResponse {
  success?: boolean
}

/**
 * Verify an hCaptcha token. Returns `true` only when hCaptcha confirms the
 * token; fails closed (`false`) on any error or empty token.
 */
export async function verifyCaptcha(token: string | null | undefined): Promise<boolean> {
  if (!token) return false

  try {
    const env = getEnv()
    const body = new URLSearchParams({
      secret: env.HCAPTCHA_SECRET,
      response: token,
    })

    const res = await fetch(HCAPTCHA_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })

    if (!res.ok) return false

    const data = (await res.json()) as HCaptchaVerifyResponse
    return data.success === true
  } catch {
    return false
  }
}
