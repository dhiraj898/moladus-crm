import 'server-only'
import { getServiceClient } from '@/lib/supabase/server'
import type { WebhookEvent } from './events'

/**
 * Outbound event emitter (Spec B, design §Emit).
 *
 * `emitEvent` enqueues an HMAC-signed delivery for every ACTIVE endpoint
 * subscribed to `event` by writing a `webhook_deliveries` row (status
 * `pending`, `next_attempt_at = now`) per endpoint. The Railway cron
 * (`deliverDueWebhooks`) later POSTs the signed payloads with retry/backoff.
 *
 * Best-effort contract: this is called from hook points wrapped inside primary
 * write flows (ingest, the Razorpay webhook, stage changes, contact creation),
 * so it MUST NEVER throw back into the caller. Every failure — a client that
 * throws, a lookup error, or an insert error — is logged and swallowed; the
 * primary write always wins. When no endpoint is subscribed it is a no-op.
 *
 * `server-only`: reaches the service-role client (RLS deny-all), so it must
 * never enter the browser bundle.
 */
export async function emitEvent(
  event: WebhookEvent,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const supabase = getServiceClient()

    // Active endpoints whose `events` array contains this event (`@>`).
    const { data, error } = await supabase
      .from('webhook_endpoints')
      .select('id')
      .eq('active', true)
      .contains('events', [event])

    if (error) {
      console.error(`emitEvent(${event}) endpoint lookup failed: ${error.message}`)
      return
    }

    const endpoints = (data ?? []) as { id: string }[]
    if (endpoints.length === 0) return

    const now = new Date().toISOString()
    const rows = endpoints.map((e) => ({
      endpoint_id: e.id,
      event,
      payload,
      status: 'pending',
      next_attempt_at: now,
    }))

    const { error: insertError } = await supabase
      .from('webhook_deliveries')
      .insert(rows)

    if (insertError) {
      console.error(`emitEvent(${event}) enqueue failed: ${insertError.message}`)
    }
  } catch (err) {
    // Never break the primary write that triggered the event.
    console.error(`emitEvent(${event}) threw:`, err)
  }
}
