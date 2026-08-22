# AiSensy WhatsApp Chat (Spec 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed the live WhatsApp conversation inside the CRM. Build the *receiving end* — a `messages` table, a signature-verified inbound webhook that captures every inbound + outbound WhatsApp message from the AiSensy Project API, and a read-only thread view on the Deal detail and Contact detail pages. AiSensy has no thread-fetch API, so capture-it-yourself via webhook is the only path; the live subscription is a manual ENV-PENDING step after deploy.

**Architecture:** Extends the merged v1 Next.js 15 + Supabase app (Specs 1–5). One new table `messages` (migration `0008_messages.sql`, RLS deny-all). A new `POST /api/webhooks/aisensy` route mirrors the durable, signature-first Razorpay webhook: verify `X-AiSensy-Signature` (HMAC-SHA256, timing-safe) over the RAW body *before* parsing, then idempotent-upsert a `messages` row keyed on `aisensy_message_id`. A server-only query loads a conversation by `contact_id` OR normalized `phone_number`; a presentational `ConversationThread` renders it. Read-only in v1 (no CRM composer). All DB access via the service-role client.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase JS, Zod, Vitest, Tailwind (design tokens), `node:crypto`.

## Global Constraints

- Node 20+; Next.js 15 App Router; TypeScript strict.
- Supabase accessed ONLY server-side via `SUPABASE_SERVICE_ROLE_KEY` (`getServiceClient()` in `src/lib/supabase/server.ts`). RLS deny-all on the new `messages` table.
- The webhook route MUST verify the signature over the RAW request body BEFORE parsing JSON; `export const runtime = 'nodejs'` (needed for `node:crypto`). Bad/missing signature → `401`, nothing processed.
- Idempotency: upsert keyed on `messages.aisensy_message_id` (unique), `ignoreDuplicates: true` — retries are no-ops. A non-duplicate storage error → `500` so AiSensy retries.
- Never drop a message: on no contact match, store with `contact_id = null` and keep the normalized `phone_number`.
- Design system: Inter only, dark-default tokens, `--accent:#ff4500`, colors via CSS vars. Match existing admin detail screens (`border-line`, `bg-surface`, `text-dim`, `en-IN` date formatting).
- Gates per task: `cd '/Users/dhirajghosal/Documents/Molades CRM' && npm run lint && npm run type-check && npm run build` (+ `npm run test` where tests exist).
- Never run `npm run dev` or any long-running server in a gate.
- Migrations are SQL files under `supabase/migrations/`; applied out-of-band (do NOT run them against a DB in a gate). The build must stay green without applying them (types are hand-authored).
- No application code beyond what each task lists; no send-from-CRM in v1.

---

## File Structure

- `supabase/migrations/0008_messages.sql` — `messages` table + RLS deny-all + unique `aisensy_message_id` + `(contact_id, sent_at)` and `(phone_number, sent_at)` indexes.
- `src/lib/supabase/types.ts` — add `MessageDirection` + `Message`.
- `src/lib/env.ts` — add `AISENSY_WEBHOOK_SECRET` to the Zod schema.
- `.env.example` — document `AISENSY_WEBHOOK_SECRET` under AiSensy.
- `src/features/aisensy/verify.ts` — `verifyAiSensySignature` (timing-safe HMAC-SHA256).
- `src/features/aisensy/verify.test.ts` — signature-verify unit tests.
- `src/app/api/webhooks/aisensy/route.ts` — signature-first, idempotent inbound webhook.
- `src/app/api/webhooks/aisensy/route.test.ts` — 401-on-bad-sig / 200-on-valid route tests.
- `src/features/messages/queries.ts` — `normalizePhone` + `getConversation` (server-only).
- `src/features/messages/ConversationThread.tsx` — read-only thread component.
- Modify `src/app/admin/deals/[id]/page.tsx` and `src/app/admin/contacts/[id]/page.tsx` — mount the thread.

---

## Workstream 1: db + env (migration, types, env var)

### Task 1.1: Migration 0008_messages.sql

**Files:**
- Create: `supabase/migrations/0008_messages.sql`

**Interfaces:**
- Produces (DB): table `messages` with unique `aisensy_message_id`, RLS enabled (deny-all), two composite indexes.

- [ ] **Step 1: Write the migration** (verbatim):

```sql
-- 0008_messages.sql — AiSensy WhatsApp conversation capture (Spec 6). Apply out-of-band.

create table if not exists messages (
  id                 uuid primary key default gen_random_uuid(),
  contact_id         uuid references contacts(id) on delete set null,
  aisensy_message_id text not null unique,
  direction          text not null check (direction in ('inbound','outbound')),
  sender             text,
  body               text,
  message_type       text,
  phone_number       text,
  raw                jsonb not null default '{}',
  sent_at            timestamptz,
  created_at         timestamptz not null default now()
);
alter table messages enable row level security;
create index if not exists messages_contact_sent on messages (contact_id, sent_at);
create index if not exists messages_phone_sent   on messages (phone_number, sent_at);
```

- [ ] **Step 2: Gate** — none (SQL only; not applied in CI). Confirm the file parses by eye.

### Task 1.2: Types + env

**Files:**
- Modify: `src/lib/supabase/types.ts`, `src/lib/env.ts`, `.env.example`

**Interfaces:**
- Produces: `Message`, `MessageDirection` types; `env.AISENSY_WEBHOOK_SECRET: string`.

- [ ] **Step 1: Add types** to `src/lib/supabase/types.ts` (after the existing string-union block and near the other row types):

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

- [ ] **Step 2: Add env** to the Zod schema in `src/lib/env.ts` (next to `RAZORPAY_WEBHOOK_SECRET`). It MUST be `.optional()` — NOT required. `getEnv()` calls `schema.parse(process.env)` over the whole object, so making this required would throw a ZodError in EVERY `getEnv()` consumer (ingest captcha, payment-link creation, cron, razorpay) at runtime until the secret is set — a whole-app 500 during the documented deploy-first/set-secret-after window. Optional keeps the rest of the app running; the webhook route handles absence itself (Step in the webhook task):

```ts
  AISENSY_WEBHOOK_SECRET: z.string().min(1).optional(),
```
The inbound webhook route MUST check for the secret and return **503** ("webhook not configured") when it is unset, before attempting signature verification — so an un-provisioned webhook fails safe without a crash. Add this guard to the webhook route task.

- [ ] **Step 3: Document env** in `.env.example` under the AiSensy section:

```
# AiSensy
AISENSY_API_KEY=
# Project API Custom App shared secret — HMAC key for inbound webhook signatures
AISENSY_WEBHOOK_SECRET=
```

- [ ] **Step 4: Gate** — `npm run lint && npm run type-check && npm run build`
- [ ] **Step 5: Commit** — `git commit -am "feat(chat): messages table migration, types, webhook env"`

---

## Workstream 2: signature verification (TDD)

### Task 2.1: verifyAiSensySignature + test

**Files:**
- Create: `src/features/aisensy/verify.ts`, `src/features/aisensy/verify.test.ts`

**Interfaces:**
- Produces: `verifyAiSensySignature(rawBody: string, signature: string | null | undefined, secret: string): boolean`

- [ ] **Step 1: Write the test first** — `src/features/aisensy/verify.test.ts` (mirror `src/features/razorpay/verify.test.ts`):

```ts
import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyAiSensySignature } from './verify'

const SECRET = 'whsec_test_aisensy'

/** Sign a body as AiSensy does: HMAC-SHA256 hex over the raw body. */
function sign(body: string, secret = SECRET): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

describe('verifyAiSensySignature', () => {
  const rawBody = JSON.stringify({
    topic: 'message.created',
    data: { id: 'msg_123', sender: 'USER', phone_number: '919812345678' },
  })

  it('returns true for a valid signature over the raw body', () => {
    expect(verifyAiSensySignature(rawBody, sign(rawBody), SECRET)).toBe(true)
  })

  it('accepts an optional sha256= prefix', () => {
    expect(verifyAiSensySignature(rawBody, `sha256=${sign(rawBody)}`, SECRET)).toBe(true)
  })

  it('returns false when the body is tampered with', () => {
    const signature = sign(rawBody)
    const tampered = rawBody.replace('msg_123', 'msg_evil')
    expect(verifyAiSensySignature(tampered, signature, SECRET)).toBe(false)
  })

  it('returns false for a signature made with a different secret', () => {
    expect(verifyAiSensySignature(rawBody, sign(rawBody, 'wrong'), SECRET)).toBe(false)
  })

  it('returns false for a missing signature', () => {
    expect(verifyAiSensySignature(rawBody, null, SECRET)).toBe(false)
    expect(verifyAiSensySignature(rawBody, undefined, SECRET)).toBe(false)
    expect(verifyAiSensySignature(rawBody, '', SECRET)).toBe(false)
  })

  it('returns false for a signature of the wrong length', () => {
    expect(verifyAiSensySignature(rawBody, 'abc123', SECRET)).toBe(false)
  })
})
```

- [ ] **Step 2: Implement** — `src/features/aisensy/verify.ts`:

```ts
import crypto from 'node:crypto'

/**
 * Verify an AiSensy Project-API webhook signature (Spec 6 design §5).
 *
 * AiSensy signs the webhook by computing HMAC-SHA256 over the RAW request body
 * using the Custom App shared secret, and sends the hex digest in
 * `X-AiSensy-Signature`. We recompute and compare in constant time. The caller
 * MUST pass the raw, unparsed body — re-serialising parsed JSON changes the
 * bytes and would always fail. Tolerates an optional `sha256=` prefix.
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

  // timingSafeEqual throws on length mismatch; guard first so a wrong length
  // returns false instead of throwing.
  if (expectedBuf.length !== providedBuf.length) return false

  return crypto.timingSafeEqual(expectedBuf, providedBuf)
}
```

- [ ] **Step 3: Gate** — `npm run lint && npm run type-check && npm run test && npm run build`
- [ ] **Step 4: Commit** — `git commit -am "feat(chat): timing-safe AiSensy webhook signature verify"`

---

## Workstream 3: inbound webhook route (TDD)

### Task 3.1: POST /api/webhooks/aisensy + test

**Files:**
- Create: `src/app/api/webhooks/aisensy/route.ts`, `src/app/api/webhooks/aisensy/route.test.ts`

**Interfaces:**
- Produces: `POST(req: Request): Promise<Response>` — `503` when `AISENSY_WEBHOOK_SECRET` is unset (checked first); `401` on bad/missing signature; `400` on invalid JSON; `500` on non-duplicate storage error; `200` (`{ ok: true }`) otherwise (including duplicates). Add a test case: with `getEnv` mocked to return no `AISENSY_WEBHOOK_SECRET`, the route returns `503` and never touches the DB.
- Consumes: `verifyAiSensySignature` (WS2), `getEnv`, `getServiceClient`.

- [ ] **Step 1: Write the test first** — `src/app/api/webhooks/aisensy/route.test.ts` (mock `@/lib/env` and `@/lib/supabase/server`; mirror `src/app/api/cron/scan/route.test.ts`):

```ts
import crypto from 'node:crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const SECRET = 'whsec_test_aisensy'

// Chainable supabase mock: contacts.select(...).eq(...).order(...).limit(...).maybeSingle()
const maybeSingleMock = vi.fn(async () => ({ data: { id: 'contact-1' } }))
const upsertMock = vi.fn(async () => ({ error: null }))

function makeClient() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'messages') return { upsert: upsertMock }
      // contacts lookup
      return {
        select: () => ({
          eq: () => ({
            order: () => ({ limit: () => ({ maybeSingle: maybeSingleMock }) }),
          }),
        }),
      }
    }),
  }
}

vi.mock('@/lib/env', () => ({
  getEnv: () => ({ AISENSY_WEBHOOK_SECRET: SECRET }),
}))
vi.mock('@/lib/supabase/server', () => ({
  getServiceClient: () => makeClient(),
}))

import { POST } from './route'

function sign(body: string, secret = SECRET): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

function req(body: string, signature?: string | null): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (signature) headers['x-aisensy-signature'] = signature
  return new Request('https://app.test/api/webhooks/aisensy', {
    method: 'POST',
    headers,
    body,
  })
}

const inbound = JSON.stringify({
  topic: 'message.sender.user',
  data: {
    id: 'msg_1',
    sender: 'USER',
    message_type: 'text',
    body: 'hi',
    phone_number: '+91 98123 45678',
    sent_at: '2026-08-22T10:00:00Z',
  },
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/webhooks/aisensy', () => {
  it('401s on a missing signature and never touches the DB', async () => {
    const res = await POST(req(inbound))
    expect(res.status).toBe(401)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('401s on a bad signature and never touches the DB', async () => {
    const res = await POST(req(inbound, 'sha256=deadbeef'))
    expect(res.status).toBe(401)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('200s on a valid signature and upserts one message row', async () => {
    const res = await POST(req(inbound, sign(inbound)))
    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalledTimes(1)
    const [row, opts] = upsertMock.mock.calls[0]
    expect(row).toMatchObject({
      aisensy_message_id: 'msg_1',
      direction: 'inbound',
      sender: 'USER',
      phone_number: '919812345678', // normalized
      contact_id: 'contact-1',
    })
    expect(opts).toMatchObject({ onConflict: 'aisensy_message_id', ignoreDuplicates: true })
  })

  it('classifies API/AGENT/SYSTEM senders as outbound', async () => {
    const outbound = JSON.stringify({
      topic: 'message.created',
      data: { id: 'msg_2', sender: 'API', body: 'template', phone_number: '919812345678' },
    })
    const res = await POST(req(outbound, sign(outbound)))
    expect(res.status).toBe(200)
    expect(upsertMock.mock.calls[0][0]).toMatchObject({ direction: 'outbound' })
  })
})
```

- [ ] **Step 2: Implement** — `src/app/api/webhooks/aisensy/route.ts`:

```ts
import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { getEnv } from '@/lib/env'
import { getServiceClient } from '@/lib/supabase/server'
import { verifyAiSensySignature } from '@/features/aisensy/verify'
import type { MessageDirection } from '@/lib/supabase/types'

/**
 * AiSensy Project-API inbound webhook (Spec 6 design §5).
 *
 * Contract (mirrors the Razorpay webhook's durable, signature-first pattern):
 *  1. Verify HMAC-SHA256 `X-AiSensy-Signature` over the RAW body. Invalid → 401,
 *     nothing processed.
 *  2. Parse only after the signature is trusted. Malformed JSON → 400.
 *  3. Resolve the contact by normalized phone (null when unknown — never drop).
 *  4. Idempotent upsert into `messages` keyed on aisensy_message_id.
 *  5. Return 200. Non-duplicate storage error → 500 (AiSensy retries).
 *
 * Node runtime is required for node:crypto.
 */
export const runtime = 'nodejs'

/** Digits-only, matching src/features/messages/queries.ts normalizePhone. */
function normalizePhone(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\D/g, '') : ''
}

interface AiSensyMessageData {
  id?: string
  message_id?: string
  sender?: string
  message_type?: string
  type?: string
  body?: string
  message?: string
  text?: string
  phone_number?: string
  sent_at?: string
}

interface AiSensyWebhookBody {
  topic?: string
  data?: AiSensyMessageData
  message?: AiSensyMessageData
}

export async function POST(req: Request): Promise<Response> {
  const env = getEnv()

  // 0. Fail safe when the webhook secret is not configured yet (deploy-first,
  //    set-secret-after window). AISENSY_WEBHOOK_SECRET is optional in env, so
  //    getEnv() does not throw; the route refuses cleanly instead of crashing.
  if (!env.AISENSY_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }

  // 1. Verify signature over the RAW body.
  const rawBody = await req.text()
  const signature = req.headers.get('x-aisensy-signature')
  if (!verifyAiSensySignature(rawBody, signature, env.AISENSY_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  // 2. Parse only after the signature is trusted.
  let body: AiSensyWebhookBody
  try {
    body = JSON.parse(rawBody) as AiSensyWebhookBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const msg = body.data ?? body.message ?? {}
  const sender = msg.sender ?? null
  const direction: MessageDirection = sender === 'USER' ? 'inbound' : 'outbound'
  const messageBody = msg.body ?? msg.message ?? msg.text ?? null
  const phone = normalizePhone(msg.phone_number)
  const sentAt = msg.sent_at ?? null

  // Idempotency key: the provider message id, or a deterministic composite when
  // absent (mirrors the Razorpay route's event-id fallback).
  const aisensyMessageId =
    msg.id ??
    msg.message_id ??
    `${sentAt ?? 'na'}:${phone || 'na'}:${crypto
      .createHash('sha1')
      .update(messageBody ?? '')
      .digest('hex')
      .slice(0, 12)}`

  const supabase = getServiceClient()

  // 3. Resolve contact by normalized phone (deterministic first match). Never
  // fatal: on no match, store with contact_id null and keep phone_number.
  let contactId: string | null = null
  if (phone) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('whatsapp_number', msg.phone_number ?? phone)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    contactId = (contact as { id: string } | null)?.id ?? null
  }

  // 4. Idempotent upsert keyed on aisensy_message_id.
  const { error } = await supabase.from('messages').upsert(
    {
      contact_id: contactId,
      aisensy_message_id: aisensyMessageId,
      direction,
      sender,
      body: messageBody,
      message_type: msg.message_type ?? msg.type ?? null,
      phone_number: phone || null,
      raw: body,
      sent_at: sentAt,
    },
    { onConflict: 'aisensy_message_id', ignoreDuplicates: true },
  )

  if (error) {
    return NextResponse.json({ error: 'storage error' }, { status: 500 })
  }

  // 5. Ack.
  return NextResponse.json({ ok: true })
}
```

> **Contact match note:** the DB stores `whatsapp_number` as entered; the query above matches on the raw payload number. If live testing shows format drift between AiSensy's `phone_number` and stored `whatsapp_number`, tighten to a normalized comparison (e.g. an RPC or a generated normalized column) during ENV-PENDING — the `phone_number` column already stored on `messages` guarantees the thread still renders via the phone key regardless.

- [ ] **Step 3: Gate** — `npm run lint && npm run type-check && npm run test && npm run build`
- [ ] **Step 4: Commit** — `git commit -am "feat(chat): signature-verified AiSensy inbound webhook"`

---

## Workstream 4: thread query + component

### Task 4.1: getConversation query

**Files:**
- Create: `src/features/messages/queries.ts`

**Interfaces:**
- Produces:
  - `normalizePhone(raw: string | null | undefined): string`
  - `getConversation(params: { contactId?: string | null; whatsappNumber?: string | null }): Promise<Message[]>`

- [ ] **Step 1: Implement** — `src/features/messages/queries.ts`:

```ts
import 'server-only'
import { getServiceClient } from '@/lib/supabase/server'
import type { Message } from '@/lib/supabase/types'

/** Digits-only phone normalization, shared with the inbound webhook. */
export function normalizePhone(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '')
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CONVERSATION_LIMIT = 500

/**
 * Load a WhatsApp conversation, matched by contact_id OR normalized phone (so
 * messages captured before the contact link, or with contact_id null, still
 * appear). Oldest-first for chat rendering. Returns [] when no valid key.
 * Both keys are validated/sanitized before interpolation into the .or() filter.
 */
export async function getConversation(params: {
  contactId?: string | null
  whatsappNumber?: string | null
}): Promise<Message[]> {
  const contactId =
    params.contactId && UUID_RE.test(params.contactId) ? params.contactId : null
  const phone = normalizePhone(params.whatsappNumber)

  const filters: string[] = []
  if (contactId) filters.push(`contact_id.eq.${contactId}`)
  if (phone) filters.push(`phone_number.eq.${phone}`)
  if (filters.length === 0) return []

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .or(filters.join(','))
    .order('sent_at', { ascending: true })
    .limit(CONVERSATION_LIMIT)

  if (error) throw new Error(`Failed to load conversation: ${error.message}`)
  return (data ?? []) as unknown as Message[]
}
```

- [ ] **Step 2: Gate** — `npm run lint && npm run type-check && npm run build`

### Task 4.2: ConversationThread component

**Files:**
- Create: `src/features/messages/ConversationThread.tsx`

**Interfaces:**
- Produces: `ConversationThread({ messages }: { messages: Message[] }): JSX.Element` — read-only bubble list.

- [ ] **Step 1: Implement** — `src/features/messages/ConversationThread.tsx` (server-compatible, no client JS; design tokens; `en-IN` date formatting to match the detail pages):

```tsx
import type { Message } from '@/lib/supabase/types'

function formatDateTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
}

/** Read-only WhatsApp conversation (Spec 6). Inbound left, outbound right. */
export default function ConversationThread({ messages }: { messages: Message[] }) {
  if (messages.length === 0) {
    return (
      <div className="text-sm text-dim">
        No WhatsApp messages captured yet.
        <span className="mt-1 block text-xs text-faint">
          Capture begins only once the AiSensy webhook is live — there is no
          history before that.
        </span>
      </div>
    )
  }

  return (
    <ul className="flex max-h-[520px] flex-col gap-2 overflow-y-auto">
      {messages.map((m) => {
        const outbound = m.direction === 'outbound'
        const isText = !m.message_type || m.message_type === 'text'
        return (
          <li
            key={m.id}
            className={['flex', outbound ? 'justify-end' : 'justify-start'].join(' ')}
          >
            <div
              className={[
                'max-w-[75%] rounded-[12px] border px-3 py-2',
                outbound
                  ? 'border-accent/40 bg-accent/10'
                  : 'border-line bg-surface2',
              ].join(' ')}
            >
              {!isText && (
                <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-dim">
                  {m.message_type}
                </div>
              )}
              {m.body ? (
                <div className="whitespace-pre-wrap break-words text-sm text-text">
                  {m.body}
                </div>
              ) : (
                <div className="text-sm italic text-dim">(no text)</div>
              )}
              <div className="mt-1 text-right text-[11px] tabular-nums text-faint">
                {formatDateTime(m.sent_at)}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
```

- [ ] **Step 2: Gate** — `npm run lint && npm run type-check && npm run build`
- [ ] **Step 3: Commit** — `git commit -am "feat(chat): conversation query + read-only thread component"`

---

## Workstream 5: mount on detail pages

### Task 5.1: Deal detail + Contact detail threads

**Files:**
- Modify: `src/app/admin/deals/[id]/page.tsx`, `src/app/admin/contacts/[id]/page.tsx`

**Interfaces:**
- Consumes: `getConversation` (WS4.1), `ConversationThread` (WS4.2).

- [ ] **Step 1: Deal detail** — in `src/app/admin/deals/[id]/page.tsx`, import both, load the conversation from the resolved contact, and render a "WhatsApp" card after the existing sections:

```tsx
import { getConversation } from '@/features/messages/queries'
import ConversationThread from '@/features/messages/ConversationThread'
// ...inside the component, after `contact` is available:
const messages = await getConversation({
  contactId: contact?.id ?? null,
  whatsappNumber: contact?.whatsapp_number ?? null,
})
// ...in the JSX, a new section card:
<section className="mt-4 rounded-[12px] border border-line bg-surface p-5">
  <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-dim">
    WhatsApp
  </h2>
  <ConversationThread messages={messages} />
</section>
```

- [ ] **Step 2: Contact detail** — same in `src/app/admin/contacts/[id]/page.tsx`, loading with `{ contactId: contact.id, whatsappNumber: contact.whatsapp_number }`; add the "WhatsApp" section card.
- [ ] **Step 3: Gate** — `npm run lint && npm run type-check && npm run test && npm run build`
- [ ] **Step 4: Commit** — `git commit -am "feat(chat): mount WhatsApp thread on deal + contact detail"`

---

## Workstream 6: ENV-PENDING verification (manual, post-deploy — do NOT run in CI)

Documented here so it is not forgotten; **none of this is a build gate**. See design §9.

- [ ] **Step 1:** User creates an AiSensy Project-API **Custom App** (Pro plan) and copies its **shared secret**.
- [ ] **Step 2:** Set `AISENSY_WEBHOOK_SECRET` in Railway (and `.env.local` for local testing).
- [ ] **Step 3:** Subscribe the webhook to `https://<app-domain>/api/webhooks/aisensy` for topics `message.sender.user` and `message.created`.
- [ ] **Step 4:** Send a real WhatsApp message to the business number; confirm a `messages` row is written (contact resolved when the sender is a known contact) and the bubble appears in that contact's/deal's thread.
- [ ] **Step 5:** Confirm the actual signature encoding against the real delivery (hex vs. base64, `sha256=` prefix); adjust `verifyAiSensySignature` only if the beta format differs. Confirm the `phone_number` ↔ `whatsapp_number` match works; tighten normalization if it drifts.
- [ ] **Known limits to communicate:** beta webhook (payload may change; `raw` retained to adapt); **no backfill** (thread starts at go-live); **read-only** (replies still sent from AiSensy; a composer needs non-template session-send support).

---

## Self-Review Notes

- **Spec coverage:** design §4 data model → WS1; §5 signature verify → WS2; §5 webhook route → WS3; §6 contact resolution → WS3 (webhook) + WS4 (query, phone key); §7 thread query + component → WS4; §7 mounts → WS5; §8 tests → WS2/WS3; §9 ENV-PENDING → WS6; §10 env var → WS1.2. All in-scope items covered; OUT items (backfill, send-from-CRM) left out by design and surfaced in the empty state.
- **Placeholder scan:** no TBD/TODO; each code step ships concrete code or an exact behavior list. Signature verify, webhook route, conversation query, and thread component are given verbatim.
- **Type/name consistency:** `Message` / `MessageDirection` (WS1.2) used unchanged in WS3/WS4/WS4.2/WS5; `verifyAiSensySignature(rawBody, signature, secret)` identical across WS2 impl, WS2 test, WS3 route; `getConversation({ contactId, whatsappNumber })` identical across WS4.1, WS5.1, WS5.2; `normalizePhone` digits-only rule identical in the route (WS3) and the query (WS4.1); upsert `onConflict: 'aisensy_message_id', ignoreDuplicates: true` identical in route + route test.
- **Security invariants:** signature verified over the RAW body before any parse (WS3); `401` on bad/missing sig with the DB never touched (asserted in WS3 test); `runtime = 'nodejs'`; service-role only; RLS deny-all on `messages` (WS1.1). Phone/uuid sanitized before `.or()` interpolation (WS4.1), matching `records/queries.ts` discipline.
- **Idempotency + durability:** unique `aisensy_message_id` + `ignoreDuplicates` upsert makes retries no-ops (200); a synthesized composite id covers a missing provider id; non-duplicate storage error → 500 so AiSensy retries. Mirrors the Razorpay route.
- **Never-drop invariant:** no contact match → `contact_id null`, `phone_number` retained; the thread still renders via the phone key, and orphans reconcile later.
- **Migration safety:** `0008` uses `if not exists`, is idempotent, additive (no destructive DDL), RLS deny-all. Build stays green without applying it (types hand-authored in WS1.2).
- **ENV-PENDING:** the entire live capture path (Custom App, secret, subscription, real-message verification, signature-encoding confirmation) is manual and post-deploy (WS6); the build ships dark and green. Beta + no-backfill + read-only limits are documented.
