import { z } from 'zod'
import { WEBHOOK_EVENTS, type WebhookEvent } from './events'

/**
 * Zod schema for creating / updating an outbound webhook endpoint (Spec B,
 * plan WS4 Task 1).
 *
 * `url` must be a valid absolute URL (the delivery worker POSTs to it verbatim).
 * `events` is a subset of the canonical `WEBHOOK_EVENTS` catalog and must carry
 * at least one entry — an endpoint subscribed to nothing would enqueue nothing,
 * so it is rejected as a mistake rather than silently created inert. `z.enum`
 * over the catalog guarantees a caller can never subscribe to an unknown event.
 *
 * Plain module (no `server-only`): the shape is reused by the client Add-endpoint
 * form and by the server actions, so it must be safe in the browser bundle.
 */
export const endpointSchema = z.object({
  url: z.string().url('Enter a valid URL (including https://).'),
  events: z
    .array(z.enum(WEBHOOK_EVENTS as [WebhookEvent, ...WebhookEvent[]]))
    .min(1, 'Select at least one event.'),
})

/** Parsed, validated endpoint input. */
export type EndpointInput = z.infer<typeof endpointSchema>
/** Raw, pre-parse shape accepted by the schema (what callers pass in). */
export type EndpointInputRaw = z.input<typeof endpointSchema>
