# Spec 6 — AiSensy WhatsApp Chat (embedded conversation) — Design

**Date:** 2026-08-22
**Status:** Draft (awaiting review)
**Phase:** 6 of 6 in the v1.5/v2 roadmap. Builds on merged v1 + Specs 1–5.

---

## 1. Goal

Show the live WhatsApp conversation with a customer **inside the CRM**, on the Deal detail and Contact detail pages, so an admin never has to leave the app to see what was said. Messages appear as a familiar chat thread (their messages left, ours right, timestamps), read-only in v1.

---

## 2. Locked research facts (do not re-litigate)

These were established during brainstorming and are the foundation of the design:

1. **AiSensy has no "fetch a thread" API.** You can only read a single message by a known id. There is **no endpoint** that returns a conversation history. The only way to have the thread is to **capture every message ourselves** as it happens.
2. **AiSensy Project API webhooks** (Pro plan — the user has it) push messages in near-real-time via two topics:
   - `message.sender.user` — **inbound** (customer → us).
   - `message.created` — **inbound + outbound** (fires for both directions).
   Payload carries: message content (`body`/`message`), `message_type`, a `sender` enum (`SYSTEM | AGENT | USER | API`), `phone_number`, `contact_id` (AiSensy's own id), `sent_at`, and a message id.
3. **Webhooks are signed** with `X-AiSensy-Signature` — an HMAC over the raw body using the **Custom App shared secret**. We **must** verify it before trusting the body.
4. **Webhooks are officially beta**, and there is **no backfill**: only messages that arrive *after* the webhook goes live are captured. History before go-live is unrecoverable through this channel.
5. **Auth split:** the Project API / webhook uses a **Custom App shared secret** (new). The send-side campaign API we already use (`backend.aisensy.com/campaign/t1/api/v2`, `AISENSY_API_KEY`) is **separate** and unaffected.

**Consequence:** we build the *receiving end* now — a `messages` table, a signature-verified inbound webhook, and a read-only thread view. The live path (creating the AiSensy Custom App and subscribing the webhook) is a **manual, ENV-PENDING** step the user performs after deploy (§9).

---

## 3. Scope

**In scope**
- New `messages` table capturing **both** inbound and outbound WhatsApp messages (migration `0008_messages.sql`).
- Inbound webhook route `POST /api/webhooks/aisensy` — signature-first, idempotent upsert, mirrors the durable Razorpay webhook pattern.
- Contact resolution by phone number against `contacts.whatsapp_number`.
- A read-only **thread view** component mounted on the Deal detail and Contact detail pages, fed by a server-only query.
- New env `AISENSY_WEBHOOK_SECRET`.
- Unit tests: signature verification + webhook route (401 bad-sig / 200 valid).

**Out of scope (explicitly)**
- **Historical backfill.** No way to import messages sent before the webhook is live; the thread starts empty and fills forward. Documented as a known limitation, surfaced in the empty state.
- **Send-from-CRM free-text replies.** The campaign API can only send *approved templates*, not free-text session messages, so a real chat composer is not possible via AiSensy today. Noted as future work; v1 is read-only.
- Media rendering beyond a text label (images/documents show a `message_type` badge + any caption text; binary payloads are not downloaded/stored in v1).
- Lead detail (a Lead has no confirmed `whatsapp_number` until it becomes a Contact; the thread mounts on Contact + Deal, which both resolve to a contact).

---

## 4. Data model

New migration: `supabase/migrations/0008_messages.sql`. Applied **out-of-band**; the build stays green without applying it (types are hand-authored in `src/lib/supabase/types.ts`).

```sql
-- 0008_messages.sql — AiSensy WhatsApp conversation capture (Spec 6). Apply out-of-band.

create table if not exists messages (
  id                 uuid primary key default gen_random_uuid(),
  contact_id         uuid references contacts(id) on delete set null,
  aisensy_message_id text not null unique,          -- dedup / idempotency key
  direction          text not null check (direction in ('inbound','outbound')),
  sender             text,                           -- SYSTEM | AGENT | USER | API (raw enum)
  body               text,
  message_type       text,                           -- text | image | document | ...
  phone_number       text,                           -- normalized digits, for reconciliation + query
  raw                jsonb not null default '{}',    -- full webhook payload, for forensics
  sent_at            timestamptz,
  created_at         timestamptz not null default now()
);
alter table messages enable row level security;      -- deny-all; service-role only
create index if not exists messages_contact_sent on messages (contact_id, sent_at);
create index if not exists messages_phone_sent   on messages (phone_number, sent_at);
```

Notes on the schema (extends the base column list from the brief):

- **`aisensy_message_id text not null unique`** is the idempotency key. Webhooks retry; the unique constraint + an `onConflict ignoreDuplicates` upsert makes re-delivery a no-op. If AiSensy ever omits a message id, the route **synthesizes a deterministic one** (`${sent_at}:${phone}:${sha1(body).slice(0,12)}`) so dedup still holds — mirroring how the Razorpay route falls back to a composite event id.
- **`phone_number`** (an addition beyond the brief's base columns) is stored normalized (digits only). It is what lets us (a) render a thread for a Contact whose messages predate the contact link, and (b) reconcile orphan messages (`contact_id IS NULL`) to a Contact later. Indexed alongside `sent_at`.
- **`contact_id` is nullable** with `on delete set null` — see the resolution decision in §6. We **never drop a message** for lack of a matching contact.
- **`raw jsonb`** keeps the entire verified payload for debugging the beta webhook and for future re-processing.
- RLS deny-all, consistent with every other table; only the service-role client (which bypasses RLS) touches it.

Corresponding hand-authored types in `src/lib/supabase/types.ts`:

```ts
/** messages.direction */
export type MessageDirection = 'inbound' | 'outbound'

export interface Message {
  id: string
  contact_id: string | null
  aisensy_message_id: string
  direction: MessageDirection
  sender: string | null
  body: string | null
  message_type: string | null
  phone_number: string | null
  raw: Json
  sent_at: string | null
  created_at: string | null
}
```

---

## 5. Signature-verified webhook

New route `src/app/api/webhooks/aisensy/route.ts`, mirroring the durability + security contract of `src/app/api/webhooks/razorpay/route.ts`:

1. **`export const runtime = 'nodejs'`** — required for `node:crypto`.
2. **Read the RAW body** (`await req.text()`) and verify `X-AiSensy-Signature` **before parsing**. Invalid or missing → **`401`**, nothing is processed. (The Razorpay route returns 400; we use **401** for the auth failure here, as fixed by the test contract in §8.)
3. **Parse JSON only after the signature is trusted.** Malformed JSON → `400`.
4. **Derive the message fields** from the payload:
   - `aisensy_message_id` — the payload's message id (or the synthesized fallback, §4).
   - `sender` — the raw enum string.
   - `direction` — **`inbound` when `sender === 'USER'`, otherwise `outbound`** (`API`/`AGENT`/`SYSTEM` are our side). This single rule works for both topics; `message.created` fires for both directions and the `sender` enum disambiguates.
   - `body`, `message_type`, `sent_at`, `phone_number` (normalized).
5. **Resolve the contact** by normalized phone (§6).
6. **Idempotent upsert** into `messages` keyed on `aisensy_message_id`:
   ```ts
   await supabase
     .from('messages')
     .upsert(row, { onConflict: 'aisensy_message_id', ignoreDuplicates: true })
   ```
   A duplicate delivery is silently ignored — no error, still `200`.
7. **Return `200`** (`{ ok: true }`). Any storage error that is *not* a duplicate returns `500` so AiSensy retries (matching the Razorpay "ask the provider to retry" posture).

Signature verification lives in `src/features/aisensy/verify.ts`, reusing the exact timing-safe pattern from `src/features/razorpay/verify.ts`:

```ts
import crypto from 'node:crypto'

/**
 * Verify an AiSensy webhook signature: HMAC-SHA256 (hex) over the RAW body using
 * the Custom App shared secret, compared in constant time. The caller MUST pass
 * the raw, unparsed body. Tolerates an optional `sha256=` prefix on the header.
 */
export function verifyAiSensySignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature) return false
  const provided = signature.startsWith('sha256=') ? signature.slice(7) : signature
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const expectedBuf = Buffer.from(expected, 'utf8')
  const providedBuf = Buffer.from(provided, 'utf8')
  if (expectedBuf.length !== providedBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, providedBuf)
}
```

> The exact header encoding (raw hex vs. `sha256=`-prefixed, hex vs. base64) is a beta detail we confirm against a real delivery during ENV-PENDING verification (§9). The `sha256=` strip is defensive; if AiSensy turns out to use base64, this is the one spot to adjust (change `digest('hex')` → `digest('base64')`), and the route/tests are unaffected.

---

## 6. Contact resolution

- **Normalize** both sides to digits only (`(v ?? '').replace(/\D/g, '')`), so `+91 98… `, `91-98…`, and `9198…` compare equal. A shared `normalizePhone` helper is used on write (webhook) and on read (thread query).
- Match the normalized `phone_number` against `contacts.whatsapp_number` (also normalized). On a hit, set `contact_id`. On a miss, **store the row with `contact_id = null`** and keep `phone_number` — we **never skip/drop** a message.
  - *Rationale:* dropping loses data forever (no backfill). A NULL-contact message is still recoverable: a nightly/manual reconcile, or simply the thread query matching on `phone_number`, will surface it once the Contact exists.
- **Matching ambiguity:** if two contacts share a number (data-entry edge), we bind to the first match deterministically (`order by created_at asc, limit 1`) and rely on `phone_number` for display; the thread query keys on both, so nothing is hidden.
- Normalization matches the number as stored today; if a stricter E.164 normalization is later adopted for `contacts.whatsapp_number`, the same helper is reused on both sides so they stay consistent.

---

## 7. Thread view (component + query)

**Server-only query** — `src/features/messages/queries.ts`:

```ts
import 'server-only'
import { getServiceClient } from '@/lib/supabase/server'
import type { Message } from '@/lib/supabase/types'

export function normalizePhone(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '')
}

/**
 * Load the WhatsApp conversation for a contact, matched by contact_id OR
 * normalized phone number (so messages captured before the contact link, or
 * with contact_id null, still appear). Oldest-first for chat rendering.
 */
export async function getConversation(params: {
  contactId?: string | null
  whatsappNumber?: string | null
}): Promise<Message[]>
```

Implementation: build a PostgREST `.or(...)` on `contact_id.eq.<id>` and/or `phone_number.eq.<normalized>`, `.order('sent_at', { ascending: true })`, capped (e.g. `.limit(500)`). Returns `[]` when neither key is present. Mirrors the guard/whitelisting discipline in `src/features/records/queries.ts` (validate the uuid, sanitize the number to digits before interpolation).

**Presentational component** — `src/features/messages/ConversationThread.tsx` (a server-compatible component that receives `messages: Message[]`; no client JS needed in v1):

- Renders a scroll region. Each message is a bubble:
  - **inbound** → left-aligned, `bg-surface2`.
  - **outbound** → right-aligned, `bg-accent/…` tint (accent `#ff4500`), our side.
  - timestamp (`sent_at`, formatted with the existing `en-IN` `Intl.DateTimeFormat` medium/short helper) under each bubble; non-text messages show a small `message_type` badge.
- **Empty state:** "No WhatsApp messages captured yet." plus a one-line note that capture only began when the webhook went live (no history before that) — sets expectations given the no-backfill reality.
- Styling uses existing design tokens (Inter, dark-default, `border-line`, `bg-surface`, `text-dim`, `text-accent`), consistent with the detail-page cards.

**Mounts:**
- **Deal detail** (`src/app/admin/deals/[id]/page.tsx`): load with `{ contactId: contact?.id, whatsappNumber: contact?.whatsapp_number }` and render a "WhatsApp" section card after the existing sections.
- **Contact detail** (`src/app/admin/contacts/[id]/page.tsx`): load with `{ contactId: contact.id, whatsappNumber: contact.whatsapp_number }`.

Both pages are already `export const dynamic = 'force-dynamic'` server components, so the thread is always fresh on load.

---

## 8. Testing

- **`src/features/aisensy/verify.test.ts`** — mirrors `src/features/razorpay/verify.test.ts`: valid signature → `true`; tampered body → `false`; wrong secret → `false`; missing/empty signature → `false`; wrong-length signature → `false`; plus a `sha256=`-prefixed valid signature → `true`.
- **`src/app/api/webhooks/aisensy/route.test.ts`** — mirrors `src/app/api/cron/scan/route.test.ts` (mock `@/lib/env` and `@/lib/supabase/server`):
  - **401** on a bad/missing signature, and the supabase client is **never** called.
  - **200** on a valid signature, with the `messages` upsert called once and the row shaped correctly (direction derived from `sender`, phone normalized).
  - a duplicate delivery (upsert `ignoreDuplicates`) still returns **200**.
- **Gates per task:** `npm run lint && npm run type-check && npm run build` (+ `npm run test` where tests exist). Never run `npm run dev` in a gate.

---

## 9. ENV-PENDING — the whole live path (manual, after deploy)

The receiving end ships dark. Nothing captures messages until the user wires AiSensy up. These steps are **manual** and happen **after** this spec is deployed:

1. **Create an AiSensy Custom App** (Project API, Pro plan) and copy its **shared secret**.
2. **Set `AISENSY_WEBHOOK_SECRET`** to that shared secret in Railway (and locally in `.env.local` for testing). Added to the `src/lib/env.ts` Zod schema and `.env.example` by this spec.
3. **Subscribe the webhook** to `https://<app-domain>/api/webhooks/aisensy` for topics `message.sender.user` and `message.created`.
4. **Verify a real inbound message** appears: send a WhatsApp message to the business number, confirm a `messages` row is written (`contact_id` resolved if the sender is a known contact) and the bubble shows in that contact's/deal's thread.
5. **Confirm the signature encoding** against the real delivery (hex vs. base64, prefix); adjust `verifyAiSensySignature` only if the beta format differs from the assumption in §5.

**Known limitations to communicate:**
- **Beta:** the Project API webhook is officially beta — behavior/payload may change; `raw` jsonb is retained precisely so we can adapt.
- **No backfill:** only messages from webhook-go-live forward are captured. The thread has no history before that, by design of AiSensy's API. The empty state says so.
- **Read-only:** replies must still be sent from AiSensy/WhatsApp directly; a CRM composer is future work gated on session-message (non-template) send support.

---

## 10. New environment variable

| Var | Where | Purpose |
| --- | --- | --- |
| `AISENSY_WEBHOOK_SECRET` | server-only | Custom App shared secret; HMAC key for `X-AiSensy-Signature` verification. |

Added to the `src/lib/env.ts` schema (`z.string().min(1)`) and to `.env.example` under the AiSensy section. Consistent with `RAZORPAY_WEBHOOK_SECRET`.
