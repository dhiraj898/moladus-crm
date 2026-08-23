/**
 * Outbound webhook event catalog (Spec B, design §Event types).
 *
 * The starter set of CRM events an endpoint can subscribe to. `WEBHOOK_EVENTS`
 * is the canonical ordered list (used for validation + rendering checkboxes);
 * `EVENT_LABELS` maps each to a human label for the Settings → Webhooks UI.
 *
 * Plain module (no `server-only`) — the union + labels are safe on the client
 * for the endpoint-subscription form.
 */

/** The events an external endpoint may subscribe to. */
export type WebhookEvent =
  | 'submission.created'
  | 'deal.created'
  | 'deal.paid'
  | 'deal.payment_failed'
  | 'deal.stage_changed'
  | 'contact.created'

/** Canonical ordered list of every subscribable event. */
export const WEBHOOK_EVENTS: WebhookEvent[] = [
  'submission.created',
  'deal.created',
  'deal.paid',
  'deal.payment_failed',
  'deal.stage_changed',
  'contact.created',
]

/** Human-readable labels for each event, for the config UI. */
export const EVENT_LABELS: Record<WebhookEvent, string> = {
  'submission.created': 'Submission created',
  'deal.created': 'Deal created',
  'deal.paid': 'Deal paid',
  'deal.payment_failed': 'Deal payment failed',
  'deal.stage_changed': 'Deal stage changed',
  'contact.created': 'Contact created',
}
