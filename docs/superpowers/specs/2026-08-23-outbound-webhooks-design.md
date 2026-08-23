# Spec B — Outbound Event Webhooks — Design

**Date:** 2026-08-23
**Status:** Draft

## Goal
Let admins register external URLs and subscribe them to CRM events (e.g. `deal.paid`). When an event fires, the system enqueues an **HMAC-signed POST**, delivered by the Railway cron with retry/backoff, and logged.

## Decisions (locked 2026-08-23)
- **Events (starter set):** `submission.created`, `deal.created`, `deal.paid`, `deal.payment_failed`, `deal.stage_changed`, `contact.created`. Each endpoint subscribes to any subset.
- **Delivery:** queued + retried via the existing Railway cron (reuses the SLA-scanner pattern). Not inline.
- **Per-endpoint secret:** an HMAC signing secret, stored encrypted via Spec A's `encryptSecret`/`decryptSecret`.

## Data model — migration `0010_outbound_webhooks.sql`
```sql
create table webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  events text[] not null default '{}',
  secret_enc text not null,               -- AES-GCM (Spec A crypto)
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);
alter table webhook_endpoints enable row level security;

create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references webhook_endpoints(id) on delete cascade,
  event text not null,
  payload jsonb not null,
  status text not null check (status in ('pending','delivered','failed')) default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  response_code integer,
  error text,
  created_at timestamptz not null default now()
);
alter table webhook_deliveries enable row level security;
create index webhook_deliveries_due on webhook_deliveries (next_attempt_at) where status = 'pending';
create index webhook_deliveries_endpoint on webhook_deliveries (endpoint_id, created_at desc);
```

## Event types
`src/features/webhooks/events.ts` — `WebhookEvent` union of the 6 event names + `EVENT_LABELS` for the UI.

## Emit (`src/features/webhooks/emit.ts`)
- `emitEvent(event: WebhookEvent, payload: Record<string, unknown>): Promise<void>` — `server-only`, best-effort (never throws to caller): find active endpoints whose `events` contains `event`; insert a `webhook_deliveries` row (status `pending`, `next_attempt_at = now`) per endpoint. If none, no-op.
- **Hook points** (fire-and-forget, wrapped so a failure never breaks the primary flow):
  - ingest route → `submission.created` + `deal.created` on a fresh submission.
  - Razorpay webhook → `deal.paid` (on paid), `deal.payment_failed` (on failed/expired).
  - `changeDealStage` → `deal.stage_changed` (metadata: from/to).
  - `createContact` → `contact.created`.
  - Payloads carry stable ids + key fields (e.g. deal id, contact id, amount, stage names) — never secrets/PII beyond what the admin already sees.

## Delivery (`src/features/webhooks/deliver.ts`)
- `deliverDueWebhooks(): Promise<{ delivered: number; failed: number }>` — select `pending` deliveries with `next_attempt_at <= now` and `attempts < max_attempts` (batch, `FOR UPDATE SKIP LOCKED`-style claim). For each: decrypt the endpoint secret, POST the payload JSON to `url` with headers `X-Moladus-Event`, `X-Moladus-Delivery` (id), and `X-Moladus-Signature: sha256=HMAC(secret, rawBody)`, `Content-Type: application/json`, a ~10s timeout. On 2xx → `delivered` (+ response_code). On non-2xx/error → increment `attempts`, set `last_attempt_at`, compute `next_attempt_at = now + backoff(attempts)` (exponential: 1m,5m,30m,2h,6h), store `response_code`/`error`; when `attempts >= max_attempts` → `failed`. Best-effort per delivery; one failure never aborts the batch.
- `signWebhook(secret, rawBody): string` — HMAC-SHA256 hex (pure, tested).

## Cron
Extend `GET/POST /api/cron/scan` (same bearer `CRON_SECRET`): after `scanDueSlaRules()`, also run `deliverDueWebhooks()`; return `{ fired, delivered, failed }`. One Railway cron covers both SLA reminders + webhook delivery.

## Config UI (`/admin/settings/webhooks`)
- Settings sub-nav gains **Webhooks** (settings-gated).
- Endpoint list: URL, subscribed events (chips), active toggle, last delivery status; **Add endpoint** (URL + event checkboxes + auto-generated secret shown once); edit events/active; delete; a **Recent deliveries** panel (event, status, attempts, response code, time) per endpoint.
- Secret: generated server-side, shown once on creation (like an API key), stored encrypted, never echoed after.

## Server actions/queries (`src/features/webhooks/`)
- `listEndpoints()` (no secret), `getEndpointDeliveries(id)` — server-only reads.
- `createEndpoint({url, events})` → generate secret, `encryptSecret`, insert, return the plaintext secret **once**. `updateEndpoint(id, {events, active})`, `deleteEndpoint(id)`, `rotateSecret(id)`. All `requirePermission('settings','edit')`.

## Security
- `webhook_endpoints`/`webhook_deliveries` RLS deny-all, service-role only.
- Endpoint secret encrypted at rest; plaintext returned only once at create/rotate; never in list/read.
- Outbound URL is admin-provided; deliveries are signed so the receiver can verify authenticity. (SSRF note: admin-only feature; if opened to lower roles later, add URL allow-listing.)
- Payloads exclude sensitive secrets.

## Testing
- `signWebhook` HMAC correctness (unit).
- `deliverDueWebhooks`: due-selection, 2xx→delivered, non-2xx→retry with backoff + attempts increment, max-attempts→failed, dedupe/claim (unit, mocked fetch + client).
- `emitEvent`: enqueues one delivery per subscribed active endpoint; none when unsubscribed (unit, mocked).
- Gates incl. `npm run test`.

## Workstreams
1. **db + events** — migration 0010, types, `events.ts`.
2. **emit + hooks** — `emitEvent` + wire the 4 hook points.
3. **deliver + cron** — `signWebhook` + `deliverDueWebhooks` (TDD) + extend the cron route.
4. **actions + UI** — endpoint CRUD + Settings → Webhooks page.

## ENV-PENDING
Scheduled delivery needs the Railway cron hitting `/api/cron/scan`. Live end-to-end: create an endpoint (e.g. a webhook.site URL), trigger an event, run the cron, confirm a signed POST arrives and the delivery row flips to `delivered`.
