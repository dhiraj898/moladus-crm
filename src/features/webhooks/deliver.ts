import 'server-only'
import { getServiceClient } from '@/lib/supabase/server'
import { decryptSecret } from '@/features/integrations/crypto'
import { signWebhook } from './sign'

/**
 * Outbound webhook delivery worker (Spec B, design §Delivery).
 *
 * `deliverDueWebhooks` drains the durable `webhook_deliveries` queue: it claims
 * every `pending` row whose `next_attempt_at` is due, decrypts the endpoint's
 * per-endpoint secret, and POSTs the payload JSON to the endpoint URL with an
 * `X-Moladus-Signature: sha256=<hmac>` header so the receiver can verify
 * authenticity. A 2xx marks the row `delivered`; any non-2xx, network error, or
 * timeout increments `attempts`, records `response_code`/`error`, and reschedules
 * with exponential backoff — until `attempts` reaches `max_attempts`, when the
 * row is marked `failed` and retried no further.
 *
 * Best-effort per delivery: each row is wrapped in its own try/catch, so one
 * endpoint's failure never aborts the batch. Invoked only from the
 * secret-protected `/api/cron/scan` route (never the client); `server-only` +
 * the service-role client because `webhook_deliveries`/`webhook_endpoints` are
 * RLS deny-all.
 *
 * Returns `{ delivered, failed }` for this pass: `delivered` = rows that hit
 * 2xx, `failed` = rows that exhausted `max_attempts` this pass. Rows that failed
 * but will be retried are counted in neither.
 */

/** How many due rows one pass drains, newest-due first. */
const BATCH_LIMIT = 50

/** Per-request timeout (ms). A hung receiver must not stall the batch. */
const REQUEST_TIMEOUT_MS = 10_000

/** Exponential backoff, in minutes, indexed by the just-incremented attempt. */
const BACKOFF_MINUTES = [1, 5, 30, 120, 360]

/**
 * Minutes to wait before the next retry, given the new (1-based) attempt count.
 * Clamped to the last step so out-of-range counts never index past the array.
 */
function backoffMinutes(attempts: number): number {
  const idx = Math.min(Math.max(attempts - 1, 0), BACKOFF_MINUTES.length - 1)
  return BACKOFF_MINUTES[idx]
}

interface DueDelivery {
  id: string
  event: string
  payload: unknown
  attempts: number
  max_attempts: number
  endpoint: { url: string; secret_enc: string; active: boolean } | null
}

export async function deliverDueWebhooks(): Promise<{ delivered: number; failed: number }> {
  const supabase = getServiceClient()
  const nowIso = new Date().toISOString()

  let due: DueDelivery[]
  try {
    const { data, error } = await supabase
      .from('webhook_deliveries')
      .select(
        'id, event, payload, attempts, max_attempts, endpoint:webhook_endpoints(url, secret_enc, active)'
      )
      .eq('status', 'pending')
      .lte('next_attempt_at', nowIso)
      .order('next_attempt_at', { ascending: true })
      .limit(BATCH_LIMIT)

    if (error) {
      console.error(`deliverDueWebhooks: due query failed: ${error.message}`)
      return { delivered: 0, failed: 0 }
    }
    // Supabase types an embedded relation as an array; normalise to one object.
    due = (data ?? []).map((row) => {
      const r = row as Record<string, unknown>
      const ep = r.endpoint
      return {
        ...(r as unknown as DueDelivery),
        endpoint: Array.isArray(ep) ? (ep[0] ?? null) : (ep as DueDelivery['endpoint']),
      }
    })
  } catch (err) {
    console.error('deliverDueWebhooks: due query threw:', err)
    return { delivered: 0, failed: 0 }
  }

  let delivered = 0
  let failed = 0

  for (const row of due) {
    try {
      const endpoint = row.endpoint
      // The endpoint may have been deactivated or deleted after enqueue; skip
      // without counting (the row simply stays pending for a later pass).
      if (!endpoint || !endpoint.active || !endpoint.url || !endpoint.secret_enc) {
        continue
      }

      const secret = decryptSecret(endpoint.secret_enc)
      const rawBody = JSON.stringify(row.payload)
      const signature = signWebhook(secret, rawBody)

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      let responseCode: number | null = null
      let ok = false
      let errorText: string | null = null

      try {
        const res = await fetch(endpoint.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Moladus-Event': row.event,
            'X-Moladus-Delivery': row.id,
            'X-Moladus-Signature': `sha256=${signature}`,
          },
          body: rawBody,
          signal: controller.signal,
        })
        responseCode = res.status
        ok = res.status >= 200 && res.status < 300
        if (!ok) errorText = `HTTP ${res.status}`
      } catch (err) {
        errorText = err instanceof Error ? err.message : String(err)
      } finally {
        clearTimeout(timer)
      }

      const attemptedAt = new Date().toISOString()

      if (ok) {
        await supabase
          .from('webhook_deliveries')
          .update({
            status: 'delivered',
            attempts: row.attempts + 1,
            last_attempt_at: attemptedAt,
            response_code: responseCode,
            error: null,
          })
          .eq('id', row.id)
        delivered += 1
        continue
      }

      // Failure path: increment attempts; fail permanently at the ceiling,
      // otherwise reschedule with exponential backoff.
      const newAttempts = row.attempts + 1
      const exhausted = newAttempts >= row.max_attempts
      const patch: Record<string, unknown> = {
        attempts: newAttempts,
        last_attempt_at: attemptedAt,
        response_code: responseCode,
        error: errorText,
        status: exhausted ? 'failed' : 'pending',
      }
      if (!exhausted) {
        patch.next_attempt_at = new Date(
          Date.now() + backoffMinutes(newAttempts) * 60_000
        ).toISOString()
      }

      await supabase.from('webhook_deliveries').update(patch).eq('id', row.id)
      if (exhausted) failed += 1
    } catch (err) {
      // A single delivery's bookkeeping failure never aborts the batch.
      console.error(`deliverDueWebhooks: delivery ${row.id} threw:`, err)
    }
  }

  return { delivered, failed }
}
