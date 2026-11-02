# Events (Luma-style) — Design

**Date:** 2026-10-07
**Status:** Approved for planning

## Summary

An **Events** feature modeled on Luma: a public event page linked to a course/product,
registration with an optional **approve/reject** gate, and WhatsApp (AiSensy) messaging
across the lifecycle. **No payment** — this is the headline difference from the existing
Forms flow, which is payment-centric.

A registration creates a **contact + lead + registration** (lead `source = 'event'`). No
deal is created.

**Approach (chosen): dedicated lean event pipeline.** New `events` + `event_registrations`
tables and a `src/features/events/` module following the `features/<domain>/` convention.
Reuses helpers (contact dedupe, rate-limit, `sendWhatsAppTemplate`, the `features/views/`
list framework, the draft/publish pattern) but **not** the deal/payment/stage machinery.
Rejected alternatives: pushing registrations through `/api/ingest` + the stage engine (drags
payment code into a payment-less feature); adding event columns to `forms` (overloads one
table/UI with two lifecycles).

## Data model

Both tables: RLS enabled, no policies (deny-all; service-role bypasses). Types hand-mirrored
in `src/lib/supabase/types.ts`. Migration `0012_events.sql`.

### `events`

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `name` | text | |
| `slug` | text unique | public URL `/e/[slug]` |
| `status` | text | `draft` \| `published`. Publish requires `starts_at` and, if `product_id` set, an active product. `create` forces `draft`. |
| `product_id` | uuid fk → products, **nullable** | linked course/product |
| `description` | text | |
| `starts_at` | timestamptz | |
| `ends_at` | timestamptz, nullable | |
| `timezone` | text | e.g. `Asia/Kolkata`; display + reminder math |
| `location_type` | text | `online` \| `physical` |
| `location_value` | text | meeting link or address |
| `capacity` | int, nullable | null = unlimited |
| `requires_approval` | boolean | the per-event gate |
| `questions` | jsonb | optional extra questions `[{key,label,type,options?,required}]` |
| `wa_template_received` | text, nullable | AiSensy campaign name; null = skip |
| `wa_template_approved` | text, nullable | AiSensy campaign name; null = skip |
| `wa_template_reminder` | text, nullable | AiSensy campaign name; null = skip |
| `reminder_hours_before` | int, nullable | default 24; null = no reminder |
| `reminder_scan_at` | timestamptz, nullable | computed = `starts_at - reminder_hours_before`; cron keys off this. Recomputed whenever `starts_at` or `reminder_hours_before` changes. |
| `created_at` / `updated_at` | timestamptz | |

### `event_registrations`

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `event_id` | uuid fk → events | |
| `contact_id` | uuid fk → contacts | |
| `lead_id` | uuid fk → leads, nullable | |
| `status` | text | `pending` \| `approved` \| `rejected` \| `waitlisted` |
| `raw_payload` | jsonb | full answer set incl. optional questions |
| `reminder_sent_at` | timestamptz, nullable | idempotency guard for the reminder |
| `created_at` / `updated_at` | timestamptz | |

Unique `(event_id, contact_id)` → one registration per person per event.

**Seat accounting:** a seat is consumed by an `approved` registration. `capacity` null =
unlimited.

`0012` also adds a nullable `event_registration_id` to `notification_log` so event WhatsApp
sends are traceable (parallel to the existing deal linkage).

## Registration lifecycle (state machine)

### On register (public POST → `src/app/api/events/register/route.ts`)

1. Validate core fields (name, email, WhatsApp, consent) + the event's optional questions.
2. Match/create contact by WhatsApp (reuse Forms dedupe helper); create lead
   (`source = 'event'`); create `event_registrations` row.
3. Initial status:
   - `requires_approval = true` → **`pending`**.
   - `requires_approval = false` → seats available → **`approved`**; full → **`waitlisted`**.
4. Fire `wa_template_received` (if set). On the auto-approve path this message **is** the
   confirmation — event copy covers both cases; we do not also send `approved` on register,
   so no double-send.
5. Duplicate re-register (same contact+event) → idempotent: return existing status, no
   second WhatsApp.

### Admin actions on a registration

| action | from → to | side effect |
|---|---|---|
| Approve | `pending`/`waitlisted` → `approved` | fire `wa_template_approved`; **blocked if full** (capacity reached) with a clear message |
| Reject | `pending`/`waitlisted`/`approved` → `rejected` | **silent** (no WhatsApp); frees a seat if they were approved |
| Move to waitlist | `pending` → `waitlisted` | none |

**Capacity rule:** approve is the only transition that checks capacity. Waitlist promotion is
**manual** (admin approves a waitlisted person once a seat frees). Auto-promotion is deferred
(YAGNI).

### Reminder

Cron selects `approved` registrations where the event's `reminder_scan_at <= now()`,
`starts_at > now()`, `reminder_sent_at is null`, and `wa_template_reminder` is set → sends,
stamps `reminder_sent_at`. Idempotent; best-effort (same contract as all AiSensy sends —
never throws, logs to `notification_log`).

## Public page & admin UI

### Public — `src/app/e/[slug]/page.tsx` (server component, mirrors `/f/[slug]`)

- Load published event via `getPublishedEventBySlug` (404 on missing/draft).
- Show name, description, date/time (in event tz), location, and a badge:
  "X spots left" / "Waitlist" / "Registration closed".
- Client `EventRegister.tsx` renders core fields + optional questions, POSTs to
  `/api/events/register` (reuses ingest route's rate-limit + contact dedupe helpers).
- Success → thank-you panel whose copy reflects status (pending / approved / waitlisted).

### Admin — cloned from Forms, via the `features/views/` framework

- `src/app/admin/events/page.tsx` — list (Table/List toggle, URL filters: status,
  upcoming/past, product). Columns: name, date, status, approved/capacity, pending count.
- `src/app/admin/events/[id]/page.tsx` — detail with sectioned sub-forms:
  **Details** (name/slug/date/tz/location/capacity/approval toggle), **Linked product**,
  **Questions**, **WhatsApp templates** (3 campaign-name fields + reminder hours),
  **Registrants** table (name, WhatsApp, status, registered-at + Approve/Reject/Waitlist),
  publish/unpublish, Danger-zone delete.
- `src/app/admin/events/new/page.tsx` — create (forces `draft`).
- Mutations are server actions in `src/features/events/actions.ts`, validated by
  `src/features/events/schema.ts` (Zod). Reuses `RowDeleteButton`, `CopyLinkButton`, status
  chips. Approve/Reject/Waitlist bound per-registration (`action.bind(null, registrationId)`).

## WhatsApp wiring

- Make the deal linkage in `sendWhatsAppTemplate` optional:
  `sendWhatsAppTemplate({ dealId?, template, whatsapp, params, name })`. When `dealId` is
  absent: write `notification_log` with `deal_id = null` (+ `event_registration_id` set) and
  skip the deal-timeline activity mirror. Backward-compatible.
- **Event-specific params** resolved at send time (not the payment-oriented Forms
  `templateParams` token list). Tokens: `name`, `event_name`, `event_date` (formatted in
  event tz), `event_location` (link or address), `product`. Passed positionally in a
  documented order per template.

## Reminder cron wiring

Add `scanDueEventReminders()` to the existing `handle()` in
`src/app/api/cron/scan/route.ts`; the route returns
`{ fired, delivered, failed, remindersSent }`. One existing Railway cron covers it — no new
infra. `reminder_scan_at` is recomputed on any `starts_at` / `reminder_hours_before` change.

## Testing / verification

- Unit test for `scanDueEventReminders()` (sla.test.ts-style): picks only due + approved +
  unsent rows; stamps `reminder_sent_at`; idempotent on a second scan.
- State-machine test for approve/reject/waitlist transitions and the capacity block on
  approve.
- Registration ingest test: dedupe on repeat register; correct initial status for
  approval-on vs approval-off and full vs available.

## Deferred (YAGNI)

- Auto-promotion from waitlist when a seat frees (manual promotion only).
- WhatsApp on reject (silent by decision).
- iframe embedding of the public event page (Forms has it; Events does not until asked).
- Multiple products per event (single `product_id`).
- Multiple / configurable reminder offsets (one reminder per event).
