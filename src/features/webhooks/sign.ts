import { createHmac } from 'node:crypto'

/**
 * HMAC-SHA256 signature for an outbound webhook delivery (Spec B, design
 * §Delivery).
 *
 * `signWebhook` computes the hex-encoded HMAC-SHA256 of the exact raw request
 * body under the endpoint's per-endpoint secret. The delivery sends it as
 * `X-Moladus-Signature: sha256=<hex>` so the receiver can recompute the same
 * digest over the bytes it received and verify the payload is authentic and
 * untampered.
 *
 * Pure and deterministic (no I/O, no `server-only`) — the same secret + body
 * always yield the same digest, which is what makes it unit-testable and safe to
 * reuse from both the delivery worker and its tests.
 */
export function signWebhook(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}
