# Outbound Event Webhooks (Spec B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Register external URLs subscribed to CRM events; on an event, enqueue an HMAC-signed POST delivered by the Railway cron with retry/backoff, logged and manageable in Settings → Webhooks.

**Architecture:** `webhook_endpoints` (url, events[], encrypted secret) + `webhook_deliveries` (durable queue). `emitEvent()` enqueues a delivery per subscribed active endpoint at hook points; `deliverDueWebhooks()` (run by the existing `/api/cron/scan`) POSTs signed payloads with backoff. Reuses Spec A `encryptSecret/decryptSecret` and the SLA-scanner pattern. See `docs/superpowers/specs/2026-08-23-outbound-webhooks-design.md`.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, node:crypto (HMAC), Supabase service-role, Zod, Vitest.

## Global Constraints
- New tables RLS deny-all; access via `getServiceClient()` in `server-only` modules.
- Endpoint secret encrypted at rest via `encryptSecret` (`src/features/integrations/crypto.ts`); plaintext returned ONLY once at create/rotate; never in list/read.
- `emitEvent` is best-effort and MUST NOT throw into the primary flow (wrap at every hook point).
- Mutations assert `requirePermission('settings','edit')`; reads under the settings-gated layout / `requireModuleView('settings')`.
- Cron delivery authorized by the existing `CRON_SECRET` bearer on `/api/cron/scan`.
- Design tokens (Inter, dark-default, `--accent:#ff4500`, CSS vars); match Stages/Integrations editors.
- Gates per task: `cd '/Users/dhirajghosal/Documents/Molades CRM' && npm run lint && npm run type-check && npm run build` (+ `npm run test`). Never run `npm run dev` in a gate. Migrations out-of-band; build stays green without them.

## File Structure
- Create: `supabase/migrations/0010_outbound_webhooks.sql`; `src/features/webhooks/{events.ts, emit.ts, deliver.ts, deliver.test.ts, sign.ts, sign.test.ts, emit.test.ts, actions.ts, queries.ts, schema.ts}`
- Modify: `src/lib/supabase/types.ts`; `src/app/api/ingest/route.ts`; `src/app/api/webhooks/razorpay/route.ts`; `src/features/crm/deals/actions.ts` (changeDealStage); `src/features/crm/contacts/actions.ts` (createContact); `src/app/api/cron/scan/route.ts`; `src/app/admin/settings/SettingsNav.tsx`
- Create: `src/app/admin/settings/webhooks/{page.tsx, WebhooksEditor.tsx}`

---

## Workstream 1: db + events + types
**Files:** Create `supabase/migrations/0010_outbound_webhooks.sql`, `src/features/webhooks/events.ts`; Modify `src/lib/supabase/types.ts`
- [ ] **Step 1: Migration** — the two tables + indexes exactly as in the design doc §Data model.
- [ ] **Step 2: events.ts** — `export type WebhookEvent = 'submission.created'|'deal.created'|'deal.paid'|'deal.payment_failed'|'deal.stage_changed'|'contact.created'`; `export const WEBHOOK_EVENTS: WebhookEvent[] = [...]`; `export const EVENT_LABELS: Record<WebhookEvent,string>`.
- [ ] **Step 3: types.ts** — `WebhookEndpoint` (id, url, events: WebhookEvent[], secret_enc, active, created_at, updated_at, created_by), `WebhookDelivery` (id, endpoint_id, event, payload, status, attempts, max_attempts, last_attempt_at, next_attempt_at, response_code, error, created_at), `WebhookDeliveryStatus='pending'|'delivered'|'failed'`.
- [ ] **Step 4: Gates + Commit** — `feat(db): outbound webhook tables + event types`

## Workstream 2: emit + hooks
**Files:** Create `src/features/webhooks/emit.ts`, `emit.test.ts`; Modify ingest route, razorpay webhook route, deals/actions.ts, contacts/actions.ts
**Interfaces:** Produces `emitEvent(event: WebhookEvent, payload: Record<string, unknown>): Promise<void>` (best-effort, never throws).
- [ ] **Step 1: Test** `emit.test.ts` (mock service client): given 2 active endpoints, one subscribed to the event and one not, `emitEvent` inserts exactly ONE delivery row (pending, next_attempt_at≈now) for the subscribed one; inactive/unsubscribed → 0; a DB error is swallowed (no throw).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement emit.ts** — `server-only`; select active endpoints where `events @> [event]`; insert a delivery per endpoint; wrap in try/catch (log, never throw).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Wire hook points** (each wrapped, non-fatal, after the primary write succeeds):
  - `ingest/route.ts` — after the fresh deal is created: `await emitEvent('submission.created', {...})` and `emitEvent('deal.created', {dealId, contactId, productId})`. (Skip on the resume/dedupe path.)
  - `webhooks/razorpay/route.ts` — on paid: `emitEvent('deal.paid', {dealId, razorpay_ref, amount})`; on failed/expired: `emitEvent('deal.payment_failed', {dealId, status})`.
  - `crm/deals/actions.ts` `changeDealStage` — after the move: `emitEvent('deal.stage_changed', {dealId, from, to})`.
  - `crm/contacts/actions.ts` `createContact` — after insert: `emitEvent('contact.created', {contactId, whatsapp})`.
- [ ] **Step 6: Gates** (existing ingest/razorpay/deals/contacts tests stay green — update mocks so `emitEvent`'s service-client calls don't break them). **Commit** — `feat(webhooks): emitEvent + event hook points`

## Workstream 3: deliver + cron (TDD)
**Files:** Create `src/features/webhooks/sign.ts`, `sign.test.ts`, `deliver.ts`, `deliver.test.ts`; Modify `src/app/api/cron/scan/route.ts`
**Interfaces:** Produces `signWebhook(secret: string, rawBody: string): string` (hex HMAC-SHA256); `deliverDueWebhooks(): Promise<{delivered:number; failed:number}>`.
- [ ] **Step 1: sign test + impl** — `signWebhook` returns `crypto.createHmac('sha256', secret).update(rawBody).digest('hex')`; test a known vector + that different bodies/secrets differ.
- [ ] **Step 2: deliver test** `deliver.test.ts` (mock `getServiceClient`, `decryptSecret`, global `fetch`): a due pending delivery + a 200 fetch → status `delivered`, response_code 200, one fetch with an `X-Moladus-Signature: sha256=<hmac>` header; a 500 fetch → attempts incremented, status stays `pending` with `next_attempt_at` in the future (backoff), until attempts>=max_attempts → `failed`; a delivery not yet due (next_attempt_at future) is skipped.
- [ ] **Step 3: Run — FAIL.**
- [ ] **Step 4: Implement deliver.ts** — `server-only`; select due pending deliveries (join endpoint for url + secret_enc + active); for each: `decryptSecret`, build rawBody = JSON.stringify(payload), POST with headers (`Content-Type: application/json`, `X-Moladus-Event`, `X-Moladus-Delivery`, `X-Moladus-Signature: sha256=`+sign), ~10s AbortController timeout; 2xx→delivered; else increment attempts, set last_attempt_at + next_attempt_at via `backoff(attempts)` ([1,5,30,120,360] minutes), store response_code/error; attempts>=max_attempts→failed. Per-delivery try/catch; count delivered/failed.
- [ ] **Step 5: Run — PASS.**
- [ ] **Step 6: Extend cron** `api/cron/scan/route.ts` — after `scanDueSlaRules()`, `const wh = await deliverDueWebhooks()`; return `{ fired, delivered: wh.delivered, failed: wh.failed }`. Keep the bearer auth.
- [ ] **Step 7: Gates + Commit** — `feat(webhooks): signed delivery with retry/backoff + cron wiring + tests`

## Workstream 4: actions + UI
**Files:** Create `src/features/webhooks/schema.ts`, `actions.ts`, `queries.ts`; `src/app/admin/settings/webhooks/{page.tsx, WebhooksEditor.tsx}`; Modify `SettingsNav.tsx`
**Interfaces:** `listEndpoints()`, `getEndpointDeliveries(id)` (server-only, no secret); `createEndpoint({url, events})` → returns `{id, secret}` (plaintext once); `updateEndpoint(id, {events, active})`; `deleteEndpoint(id)`; `rotateSecret(id)` → returns new plaintext once. All `requirePermission('settings','edit')`.
- [ ] **Step 1: schema.ts** — `endpointSchema = z.object({ url: z.string().url(), events: z.array(z.enum([...6])).min(1) })`.
- [ ] **Step 2: queries.ts** — `listEndpoints` (select id,url,events,active,created_at — NOT secret_enc); `getEndpointDeliveries(id)` (recent 20).
- [ ] **Step 3: actions.ts** — `createEndpoint`: gate; validate; `secret = crypto.randomBytes(24).toString('hex')`; `encryptSecret(secret)`; insert; return `{id, secret}`. `updateEndpoint`/`deleteEndpoint`/`rotateSecret` gated; rotate regenerates + re-encrypts, returns new secret. revalidate `/admin/settings/webhooks`.
- [ ] **Step 4: SettingsNav** — add settings-gated **Webhooks** tab.
- [ ] **Step 5: page.tsx** — `force-dynamic`, `requireModuleView('settings')`, load endpoints (+deliveries), render `<WebhooksEditor>`.
- [ ] **Step 6: WebhooksEditor** (client) — endpoint list (url, event chips, active toggle, delete); Add-endpoint form (url + event checkboxes) → on create, show the returned secret ONCE in a copyable callout ("save this — shown once"); per-endpoint recent-deliveries panel (event, status chip, attempts, response code, time); rotate-secret button (shows new secret once). Design tokens; inline errors; isPending.
- [ ] **Step 7: Gates + Commit** — `feat(webhooks): endpoint CRUD + Settings → Webhooks UI`

---

## Self-Review Notes
- Coverage: tables+events (WS1), emit+hooks (WS2), sign+deliver+cron (WS3), actions+UI (WS4). All design sections covered.
- Type consistency: `WebhookEvent`, `emitEvent`, `deliverDueWebhooks`, `signWebhook`, endpoint/delivery shapes identical across WS.
- Security: secrets encrypted, shown once, never in reads; RLS deny-all; mutations gated; emit best-effort/non-fatal; signed deliveries.
- Reuse: Spec A crypto, cron bearer pattern, SLA-scanner shape.
- ENV-PENDING: Railway cron for scheduled delivery; live end-to-end via a test receiver URL.
