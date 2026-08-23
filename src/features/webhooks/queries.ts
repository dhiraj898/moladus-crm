import 'server-only'
import { getServiceClient } from '@/lib/supabase/server'
import type {
  WebhookDelivery,
  WebhookEndpoint,
} from '@/lib/supabase/types'

/**
 * Server-only reads for the Settings → Webhooks page (Spec B, plan WS4 Task 2).
 *
 * This module is `server-only`, so it never becomes a client-invocable Server
 * Action endpoint (unlike the `'use server'` module in `actions.ts`). The page
 * (gated by `settings.view` via `requireModuleView`) imports these directly and
 * hands the plain data to the client editor.
 *
 * SECURITY: `listEndpoints` NEVER selects `secret_enc` — the encrypted signing
 * secret never leaves the server, and its plaintext is only ever surfaced once
 * at create/rotate time (see `actions.ts`). Both reads use the service-role
 * client because `webhook_endpoints` / `webhook_deliveries` are RLS deny-all.
 */

/** An endpoint row for the list, minus the secret. */
export type EndpointListItem = Pick<
  WebhookEndpoint,
  'id' | 'url' | 'events' | 'active' | 'created_at'
>

/** A recent-delivery row for the per-endpoint panel (no payload body). */
export type DeliveryListItem = Pick<
  WebhookDelivery,
  | 'id'
  | 'event'
  | 'status'
  | 'attempts'
  | 'max_attempts'
  | 'response_code'
  | 'error'
  | 'last_attempt_at'
  | 'created_at'
>

/**
 * List every registered endpoint, newest first. Selects only non-secret columns
 * (never `secret_enc`). A DB error degrades to an empty list rather than
 * breaking the settings page render.
 */
export async function listEndpoints(): Promise<EndpointListItem[]> {
  try {
    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('webhook_endpoints')
      .select('id, url, events, active, created_at')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[listEndpoints] lookup failed:', error.message)
      return []
    }
    return (data ?? []) as EndpointListItem[]
  } catch (err) {
    console.error('[listEndpoints] threw:', err)
    return []
  }
}

/**
 * The 20 most-recent deliveries for one endpoint, newest first. Omits the
 * `payload` body (not needed for the status panel). A DB error degrades to an
 * empty list.
 */
export async function getEndpointDeliveries(
  endpointId: string
): Promise<DeliveryListItem[]> {
  try {
    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('webhook_deliveries')
      .select(
        'id, event, status, attempts, max_attempts, response_code, error, last_attempt_at, created_at'
      )
      .eq('endpoint_id', endpointId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      console.error('[getEndpointDeliveries] lookup failed:', error.message)
      return []
    }
    return (data ?? []) as DeliveryListItem[]
  } catch (err) {
    console.error('[getEndpointDeliveries] threw:', err)
    return []
  }
}
