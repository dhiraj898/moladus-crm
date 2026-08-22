import { createHash, timingSafeEqual } from 'node:crypto'
import { getEnv } from '@/lib/env'
import { scanDueSlaRules } from '@/features/crm/automation/sla'

/**
 * Secret-protected SLA scanner endpoint (design §6, plan WS4 Task 4.2).
 *
 * A scheduler (Railway cron, or a manual `curl`) hits this route on an interval
 * (~5 min). It authorizes with `Authorization: Bearer ${CRON_SECRET}` and,
 * on success, runs `scanDueSlaRules()` and returns `{ fired }`. Any other
 * request gets a 401 with no side effects — the scanner is the only server code
 * that fires SLA actions, so this bearer check is its authorization boundary
 * (the config UI actions use `getCurrentUser()`; this machine-to-machine route
 * cannot, so it uses the shared secret instead).
 *
 * `runtime = 'nodejs'` because the timing-safe compare uses `node:crypto`, and
 * `dynamic = 'force-dynamic'` so the route is never statically cached.
 *
 * ENV-PENDING: scheduled firing is wired at the Railway deploy (a cron job that
 * curls this route with the secret). Until then, verify manually:
 *   curl -sS -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/scan
 * expecting `{"fired":N}` (and a 401 with a wrong/absent header).
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Fixed-length SHA-256 digest, so `timingSafeEqual` never sees a length diff. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/** Constant-time bearer-token check against `Bearer ${CRON_SECRET}`. */
function isAuthorized(request: Request): boolean {
  const provided = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${getEnv().CRON_SECRET}`
  // Hash both to equal-length buffers first: `timingSafeEqual` throws on a
  // length mismatch (which would itself leak length), and hashing keeps the
  // comparison constant-time regardless of the provided header's length.
  return timingSafeEqual(digest(provided), digest(expected))
}

async function handle(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const result = await scanDueSlaRules()
  return Response.json(result)
}

export function GET(request: Request): Promise<Response> {
  return handle(request)
}

export function POST(request: Request): Promise<Response> {
  return handle(request)
}
