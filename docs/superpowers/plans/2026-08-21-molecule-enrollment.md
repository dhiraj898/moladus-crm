# Molecule Enrollment App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an app that owns the enrollment form-to-record flow end-to-end — product-linked forms, submission → Lead+Contact+Deal, GST-correct amounts, Razorpay hosted checkout, and transactional WhatsApp.

**Architecture:** Next.js 15 App Router on Railway; Supabase (Postgres + Auth) as system of record. All DB access via service-role key from server code only. Public form is SSR; ingest is a rate-limited, CAPTCHA-protected route handler; Razorpay webhook is signature-verified with durable event storage.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS, Supabase JS, Razorpay, AiSensy, hCaptcha, Zod (validation), Vitest (unit tests).

## Global Constraints

- Node 20+; Next.js 15 App Router (not Pages Router).
- TypeScript strict mode on.
- Supabase accessed ONLY server-side via `SUPABASE_SERVICE_ROLE_KEY`. The anon key never gates data access; service-role bypasses RLS.
- RLS enabled deny-all on every table.
- All secrets (Razorpay, AiSensy, service-role, hCaptcha secret) server-side env vars only — never in client bundle.
- Razorpay webhook MUST verify `X-Razorpay-Signature` (HMAC-SHA256 of raw body) before any processing.
- Design system: Inter only, dark default, `--accent:#ff4500`, all colors via CSS variables. Per Moladus Artifact Style Guide.
- Money stored as `numeric(12,2)`; GST rounded to 2 decimals per line; never hardcode tax.
- One product per form. One `product_id` per Deal.
- Gates per task: `npm run lint && npm run type-check && npm run build` (plus `npm run test` where tests exist).
- Never start a long-running dev server (`npm run dev`) in a gate — terminating commands only.

---

## Workstream 1: scaffold

### Task 1.1: Next.js + TypeScript + Tailwind project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `.eslintrc.json`, `.prettierrc`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `.env.example`, `src/lib/env.ts`

**Interfaces:**
- Produces: `src/lib/env.ts` exporting a validated `env` object with keys `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `AISENSY_API_KEY`, `HCAPTCHA_SECRET`, `NEXT_PUBLIC_HCAPTCHA_SITE_KEY`, `BUSINESS_STATE`, `NEXT_PUBLIC_APP_URL`.

- [ ] **Step 1: Scaffold**

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack --use-npm
```
Accept defaults; if the dir is non-empty create in a temp and copy in.

- [ ] **Step 2: Add deps**

```bash
npm i @supabase/supabase-js razorpay zod
npm i -D vitest @vitejs/plugin-react prettier
```

- [ ] **Step 3: Add scripts to package.json**

Ensure scripts: `"lint":"next lint"`, `"type-check":"tsc --noEmit"`, `"build":"next build"`, `"test":"vitest run"`, `"dev":"next dev"`.

- [ ] **Step 4: Write env validator**

```typescript
// src/lib/env.ts
import { z } from 'zod'

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),
  AISENSY_API_KEY: z.string().min(1),
  HCAPTCHA_SECRET: z.string().min(1),
  NEXT_PUBLIC_HCAPTCHA_SITE_KEY: z.string().min(1),
  BUSINESS_STATE: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
})

// Parse lazily so build doesn't fail without env; throws at first real use.
let cached: z.infer<typeof schema> | null = null
export function getEnv() {
  if (cached) return cached
  cached = schema.parse(process.env)
  return cached
}
```

- [ ] **Step 5: Write `.env.example`** — all keys from §13 of the spec with blank values.

- [ ] **Step 6: Gates**

Run: `npm run lint && npm run type-check && npm run build`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js + TS + Tailwind + env validation"
```

### Task 1.2: Design tokens in Tailwind + globals

**Files:**
- Modify: `app/globals.css`, `tailwind.config.ts`

**Interfaces:**
- Produces: CSS variables `--bg --surface --surface2 --line --text --dim --faint --accent --red --amber --green --chip-bg` under `:root` (dark) and `html.light`; Tailwind colors mapped to these vars.

- [ ] **Step 1: Add token block to globals.css**

Paste the full `:root` + `html.light` token block from the design language (dark defaults `--bg:#0a0a0a`, `--accent:#ff4500`; light `--bg:#faf9f7`, `--accent:#e63e00`), plus `@import url('https://rsms.me/inter/inter.css');` and body font-family/feature-settings.

- [ ] **Step 2: Map tokens in tailwind.config.ts**

```typescript
theme: { extend: { colors: {
  bg:'var(--bg)', surface:'var(--surface)', surface2:'var(--surface2)',
  line:'var(--line)', text:'var(--text)', dim:'var(--dim)', faint:'var(--faint)',
  accent:'var(--accent)', red:'var(--red)', amber:'var(--amber)', green:'var(--green)',
  'chip-bg':'var(--chip-bg)',
}, fontFamily: { sans:['InterVariable','Inter','system-ui','sans-serif'] } } }
```

- [ ] **Step 3: Add theme toggle + system detection** in `app/layout.tsx` (inline script: add `.light` on `<html>` if `prefers-color-scheme: light`).

- [ ] **Step 4: Gates** — `npm run lint && npm run type-check && npm run build`

- [ ] **Step 5: Commit** — `git commit -am "feat: design tokens + theme toggle"`

---

## Workstream 2: db

### Task 2.1: Supabase client factory

**Files:**
- Create: `src/lib/supabase/server.ts`

**Interfaces:**
- Produces: `getServiceClient()` returning a Supabase client built with the service-role key (server-only). Marked with `import 'server-only'`.

- [ ] **Step 1: Write the client**

```typescript
// src/lib/supabase/server.ts
import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { getEnv } from '@/lib/env'

export function getServiceClient() {
  const env = getEnv()
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
```

- [ ] **Step 2:** `npm i server-only`
- [ ] **Step 3: Gates** — type-check + build
- [ ] **Step 4: Commit** — `git commit -am "feat: supabase service client"`

### Task 2.2: SQL schema migration

**Files:**
- Create: `supabase/migrations/0001_init.sql`

**Interfaces:**
- Produces: all tables from spec §4 — products, forms, form_fields, leads, contacts, deals, notification_log, webhook_events — with the `deals_open_dedupe` partial unique index and RLS enabled deny-all on each.

- [ ] **Step 1: Write migration** — full DDL from spec §4 verbatim (all columns, constraints, defaults). Add at end for every table:

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
-- no policies = deny-all; service-role bypasses RLS
```

And the idempotency index:

```sql
CREATE UNIQUE INDEX deals_open_dedupe ON deals(contact_id, product_id)
  WHERE payment_status NOT IN ('paid','refunded','failed');
```

- [ ] **Step 2: Document apply step** — note in migration header: apply via Supabase SQL editor or `supabase db push` once project details are provided.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat: initial DB schema + RLS + idempotency index"`

### Task 2.3: Generated DB types

**Files:**
- Create: `src/lib/supabase/types.ts`

**Interfaces:**
- Produces: hand-authored TypeScript types mirroring §4 (`Product`, `Form`, `FormField`, `Lead`, `Contact`, `Deal`, `NotificationLog`, `WebhookEvent`, plus enums `PaymentStatus`, `FieldType`, `PriceMode`). Later regenerated via `supabase gen types` once connected; hand types unblock the build now.

- [ ] **Step 1: Write types** — one exported interface per table matching column names/nullability; union types for enums.
- [ ] **Step 2: Gates** — type-check + build
- [ ] **Step 3: Commit** — `git commit -am "feat: DB TypeScript types"`

---

## Workstream 3: admin-auth

### Task 3.1: Supabase auth middleware + login

**Files:**
- Create: `src/lib/supabase/browser.ts`, `middleware.ts`, `app/admin/login/page.tsx`, `app/admin/layout.tsx`, `src/lib/supabase/middleware-client.ts`

**Interfaces:**
- Consumes: `getEnv()` from Task 1.1.
- Produces: `middleware.ts` matching `/admin/:path*` that redirects unauthenticated users to `/admin/login`; `app/admin/layout.tsx` shell (sidebar nav to Products/Forms/Leads/Deals/Contacts) rendered only when authed.

- [ ] **Step 1: Browser client** — `createBrowserClient` (from `@supabase/ssr`) using URL + anon key for the login form only.
- [ ] **Step 2:** `npm i @supabase/ssr`
- [ ] **Step 3: Middleware** — use `@supabase/ssr` `createServerClient` bound to cookies; if no session and path starts `/admin` and not `/admin/login`, redirect to login.
- [ ] **Step 4: Login page** — email+password form calling `supabase.auth.signInWithPassword`; on success redirect to `/admin/products`. No self-registration.
- [ ] **Step 5: Admin layout** — sidebar with nav links + a sign-out button; apply design tokens.
- [ ] **Step 6: Gates** — lint + type-check + build
- [ ] **Step 7: Commit** — `git commit -am "feat: admin auth middleware + login + layout"`

---

## Workstream 4: product-master

### Task 4.1: Product server actions

**Files:**
- Create: `src/features/products/actions.ts`, `src/features/products/schema.ts`

**Interfaces:**
- Consumes: `getServiceClient()`, `Product` type.
- Produces: `listProducts()`, `getProduct(id)`, `createProduct(input)`, `updateProduct(id,input)`, `setProductActive(id,active)`. Input validated by Zod `productSchema` (name, code, sac_code, description, base_price, currency, taxable, gst_percentage, price_mode, active).

- [ ] **Step 1: Zod schema** — `productSchema` matching spec §4 fields with sensible defaults (currency INR, gst 18, price_mode exclusive).
- [ ] **Step 2: Server actions** — `'use server'`; each uses service client; return typed results; revalidate `/admin/products`.
- [ ] **Step 3: Gates** — type-check + build
- [ ] **Step 4: Commit** — `git commit -am "feat: product server actions + schema"`

### Task 4.2: Product admin screens

**Files:**
- Create: `app/admin/products/page.tsx`, `app/admin/products/new/page.tsx`, `app/admin/products/[id]/page.tsx`, `src/features/products/ProductForm.tsx`

**Interfaces:**
- Consumes: product actions from Task 4.1.
- Produces: list screen (table: name, code, base_price, gst%, active toggle, edit link) + create/edit form.

- [ ] **Step 1: List page** — server component calling `listProducts()`; render design-system table (row borders only, tabular numerals on price/gst); active shown as chip.
- [ ] **Step 2: ProductForm** — client component; all fields; price_mode + taxable controls; calls create/update actions.
- [ ] **Step 3: New + edit pages** — wire ProductForm to the right action.
- [ ] **Step 4: Gates** — lint + type-check + build
- [ ] **Step 5: Commit** — `git commit -am "feat: product admin screens"`

---

## Workstream 5: form-configurator

### Task 5.1: Form + field server actions

**Files:**
- Create: `src/features/forms/actions.ts`, `src/features/forms/schema.ts`

**Interfaces:**
- Consumes: `getServiceClient()`, `Form`, `FormField` types.
- Produces: `listForms()`, `getFormWithFields(id)`, `createForm(input)`, `updateForm(id,input)`, `publishForm(id)`, `upsertField(formId,input)`, `deleteField(id)`, `reorderFields(formId, orderedIds)`. `fieldSchema` validates key/label/field_type/required/options/binding/transform/visible_when/display_order.

- [ ] **Step 1: Zod schemas** — `formSchema` (name, slug, product_id, status, welcome_message, submit_label) + `fieldSchema`. `binding` enum: `contact.name|contact.email|contact.whatsapp_number|contact.marketing_consent|lead.source|lead.state|store_only`. `field_type` enum per spec §4. `visible_when` optional object {field_key, operator(eq|neq|in|not_in), value}.
- [ ] **Step 2: Actions** — all use service client; slug uniqueness enforced; publish only allowed when form has ≥1 field and an active product bound.
- [ ] **Step 3: Gates** — type-check + build
- [ ] **Step 4: Commit** — `git commit -am "feat: form + field server actions"`

### Task 5.2: Form list + form builder screens

**Files:**
- Create: `app/admin/forms/page.tsx`, `app/admin/forms/new/page.tsx`, `app/admin/forms/[id]/page.tsx`, `src/features/forms/FieldConfigurator.tsx`, `src/features/forms/FieldRow.tsx`

**Interfaces:**
- Consumes: form/field actions from Task 5.1; `listProducts()` for the product picker.
- Produces: form list (name, product, status, copy-link button) + builder screen (form meta editor + ordered field list with add/edit/delete/reorder; each field row exposes type, label, key, required, options, binding, visible_when).

- [ ] **Step 1: Form list page** — table + "New form"; copy-link yields `${NEXT_PUBLIC_APP_URL}/f/{slug}`.
- [ ] **Step 2: New form page** — name/slug/product picker (active products only) → create → redirect to builder.
- [ ] **Step 3: FieldConfigurator** — client; renders ordered FieldRows; add-field; up/down reorder calling `reorderFields`; publish button.
- [ ] **Step 4: FieldRow** — edit all field attributes incl. options editor (for dropdown/radio/checkbox_group) and visible_when editor (field_key + operator + value).
- [ ] **Step 5: Gates** — lint + type-check + build
- [ ] **Step 6: Commit** — `git commit -am "feat: form list + field configurator"`

---

## Workstream 6: form-engine (public form)

### Task 6.1: Conditional-logic evaluator (pure, tested)

**Files:**
- Create: `src/features/form-engine/visibility.ts`, `src/features/form-engine/visibility.test.ts`

**Interfaces:**
- Produces: `isFieldVisible(field, answers): boolean` and `visibleFields(fields, answers): FormField[]`. Rule shape `{field_key, operator: 'eq'|'neq'|'in'|'not_in', value}`; `null` visible_when = always visible.

- [ ] **Step 1: Write failing tests** — eq/neq/in/not_in true+false cases; null rule → visible; missing referenced answer → hidden for eq, visible for neq.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement `isFieldVisible` + `visibleFields`.**
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat: form conditional-logic evaluator + tests"`

### Task 6.2: Public form page (SSR shell + data)

**Files:**
- Create: `app/f/[slug]/page.tsx`, `app/f/[slug]/FormRunner.tsx`, `app/f/[slug]/not-found.tsx`, `app/f/[slug]/thank-you/page.tsx`

**Interfaces:**
- Consumes: `getServiceClient()` to load published form + fields + product; `visibleFields`.
- Produces: SSR page that 404s for missing/draft forms; passes fields + product + hCaptcha site key + ingest URL to `FormRunner`. Field definitions are server-rendered (no client fetch).

- [ ] **Step 1: Loader** — server component: fetch form by slug where status='published'; if none, `notFound()`. Fetch fields ordered by display_order + product.
- [ ] **Step 2: Render** — product header + live cost estimate (from product base_price / gst) + `<FormRunner>`.
- [ ] **Step 3: thank-you page** — Razorpay callback landing; simple confirmation.
- [ ] **Step 4: Gates** — lint + type-check + build
- [ ] **Step 5: Commit** — `git commit -am "feat: public form SSR shell + thank-you"`

### Task 6.3: FormRunner (one-at-a-time UX + transitions + conditional nav)

**Files:**
- Create: `app/f/[slug]/FormRunner.tsx` (implement), `src/features/form-engine/useFormNav.ts`

**Interfaces:**
- Consumes: `visibleFields`, field list, hCaptcha site key, ingest URL.
- Produces: client component with one-field-per-screen, progress bar over visible fields, Enter-advances / Back, animated slide+fade transitions (~0.3s), statement/yes-no auto-advance, hCaptcha on final step, POST to ingest, redirect to returned payment link.

- [ ] **Step 1: useFormNav** — hook holding answers map + current index; `next()`/`back()` skip hidden fields via `visibleFields`; progress = position within visible set.
- [ ] **Step 2: FormRunner render** — render current field by type (short_text/long_text/email/phone/number/dropdown/radio/checkbox_group/date/statement/yes_no); transitions via CSS classes.
- [ ] **Step 3: Submit** — on last field, render hCaptcha widget, collect token, POST {form_id, answers, captcha_token} to `/api/ingest`; on success `window.location = payment_link`.
- [ ] **Step 4: Loading + error states** — submit button spinner; inline error on failed ingest.
- [ ] **Step 5: Gates** — lint + type-check + build (ENV-PENDING: real browser interaction verified manually)
- [ ] **Step 6: Commit** — `git commit -am "feat: FormRunner one-at-a-time UX + conditional nav"`

---

## Workstream 7: gst

### Task 7.1: GST computation module (pure, tested)

**Files:**
- Create: `src/features/gst/compute.ts`, `src/features/gst/compute.test.ts`

**Interfaces:**
- Consumes: `Product` type, `BUSINESS_STATE` env.
- Produces: `computeGST(product, customerState): { cgst, sgst, igst, taxableAmount, total }` and `round2(n)`. Logic per spec §7.

- [ ] **Step 1: Write failing tests:**
  - non-taxable → all tax 0, total=base.
  - exclusive intra-state 1000 @18% → base 1000, cgst 90, sgst 90, igst 0, total 1180.
  - exclusive inter-state 1000 @18% → igst 180, cgst/sgst 0, total 1180.
  - inclusive intra-state 1180 @18% → base 1000, cgst 90, sgst 90, total 1180.
  - rounding: base 999.99 @18% exclusive → tax rounds to 2dp.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement `computeGST` + `round2`** exactly per spec §7 (intra-state decided by `customerState === env.BUSINESS_STATE`).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat: GST computation + tests"`

---

## Workstream 8: razorpay

### Task 8.1: Razorpay client + payment-link creation

**Files:**
- Create: `src/features/razorpay/client.ts`, `src/features/razorpay/paymentLink.ts`

**Interfaces:**
- Consumes: `getEnv()`.
- Produces: `createPaymentLink({ amountPaise, description, customer, callbackUrl }): { id, short_url }`. Amount in paise (rupees × 100, integer).

- [ ] **Step 1: Client** — instantiate Razorpay SDK with key_id + key_secret from env.
- [ ] **Step 2: createPaymentLink** — POST payment_links with amount (paise, `Math.round(total*100)`), currency INR, description, customer {name,email,contact}, callback_url, callback_method 'get'. Return id + short_url.
- [ ] **Step 3: Gates** — type-check + build (ENV-PENDING: real API call needs live keys)
- [ ] **Step 4: Commit** — `git commit -am "feat: razorpay client + payment link creation"`

### Task 8.2: Razorpay webhook handler (signature-verified, durable)

**Files:**
- Create: `app/api/webhooks/razorpay/route.ts`, `src/features/razorpay/verify.ts`

**Interfaces:**
- Consumes: `getServiceClient()`, `getEnv()`; deals table.
- Produces: `verifyRazorpaySignature(rawBody, signature, secret): boolean` (HMAC-SHA256 timing-safe compare); route that verifies signature on the RAW body, stores event in `webhook_events` (idempotent on event_id), updates deal by `razorpay_payment_link_id`, and triggers receipt notification.

- [ ] **Step 1: verify.ts** — `crypto.createHmac('sha256', secret).update(rawBody).digest('hex')`, `crypto.timingSafeEqual`.
- [ ] **Step 2: verify.test.ts** — valid signature → true; tampered body → false. Run: expect PASS.
- [ ] **Step 3: Route** — read raw body (`await req.text()`), read `x-razorpay-signature`; if invalid → 400 and stop. Parse event; upsert `webhook_events` by event id (skip if already processed). On `payment_link.paid`: set deal payment_status='paid', razorpay_ref; enqueue receipt (call aisensy sendReceipt). On `payment_link.expired`→'link_expired'; on `payment_link.cancelled`→'failed'. Mark event processed. Return 200.
- [ ] **Step 4: Gates** — lint + type-check + build + test
- [ ] **Step 5: Commit** — `git commit -am "feat: razorpay webhook (signature-verified, durable)"`

---

## Workstream 9: aisensy

### Task 9.1: AiSensy send + NotificationLog

**Files:**
- Create: `src/features/aisensy/send.ts`

**Interfaces:**
- Consumes: `getEnv()`, `getServiceClient()`.
- Produces: `sendEnrollmentLink({ dealId, name, whatsapp, paymentLink })` and `sendReceipt({ dealId, name, whatsapp, amount, productName })`. Each POSTs to AiSensy with template + params, then inserts a `notification_log` row (status sent/failed + error_message). Never throws to caller — logs failure and returns `{ ok: boolean }`.

- [ ] **Step 1: send.ts** — generic `sendTemplate(template, whatsapp, params)` → POST AiSensy campaign API with API key; wrap in try/catch. Two named wrappers `sendEnrollmentLink`/`sendReceipt` calling it + writing notification_log.
- [ ] **Step 2: Gates** — type-check + build (ENV-PENDING: real send needs live key + approved templates)
- [ ] **Step 3: Commit** — `git commit -am "feat: aisensy transactional sends + notification log"`

---

## Workstream 10: ingest

### Task 10.1: Binding + validation helpers (pure, tested)

**Files:**
- Create: `src/features/ingest/bind.ts`, `src/features/ingest/bind.test.ts`

**Interfaces:**
- Consumes: `FormField` type, `visibleFields` (Task 6.1).
- Produces: `applyBindings(fields, answers): { contact, lead, storeOnly }` and `validateAnswers(fields, answers): { ok, errors }`. Uses server-side visibility to strip hidden fields BEFORE validation and binding.

- [ ] **Step 1: Failing tests** — binding maps `contact.name`/`contact.whatsapp_number`/`lead.state` correctly; store_only lands in storeOnly; hidden required field is NOT required; transform 'string' coerces phone to String; missing visible required → error.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — filter to `visibleFields`, validate required, apply transform, route by binding prefix.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat: ingest binding + validation + tests"`

### Task 10.2: Rate limit + CAPTCHA verify

**Files:**
- Create: `src/features/ingest/rateLimit.ts`, `src/features/ingest/captcha.ts`

**Interfaces:**
- Produces: `checkRateLimit(ip): boolean` (5/min, in-memory Map with sliding window for v1) and `verifyCaptcha(token): Promise<boolean>` (POST hCaptcha siteverify with `HCAPTCHA_SECRET`).

- [ ] **Step 1: rateLimit.ts** — module-level Map<ip, timestamps[]>; prune > 60s; allow if < 5.
- [ ] **Step 2: captcha.ts** — POST to `https://hcaptcha.com/siteverify`; return `success` bool.
- [ ] **Step 3: Gates** — type-check + build
- [ ] **Step 4: Commit** — `git commit -am "feat: ingest rate limit + hCaptcha verify"`

### Task 10.3: Ingest route (the full pipeline)

**Files:**
- Create: `app/api/ingest/route.ts`

**Interfaces:**
- Consumes: `checkRateLimit`, `verifyCaptcha`, `getServiceClient`, `applyBindings`, `validateAnswers`, `computeGST`, `createPaymentLink`, `sendEnrollmentLink`.
- Produces: `POST` handler implementing spec §6 steps 1–14. Returns `{ success, payment_link }` or error JSON with correct status codes.

- [ ] **Step 1: Handler skeleton** — parse JSON {form_id, answers, captcha_token}; get IP from headers.
- [ ] **Step 2: Guards** — rate limit (429 if exceeded); captcha verify (400 if fail).
- [ ] **Step 3: Load + validate** — fetch fields for form_id + product; `validateAnswers`; 400 on errors.
- [ ] **Step 4: Bind** — `applyBindings` → contact/lead/storeOnly.
- [ ] **Step 5: Idempotency** — query open deal by contact whatsapp + product_id; if found, return its existing payment link.
- [ ] **Step 6: Create records** — upsert Contact (by whatsapp_number; set consent + timestamp when marketing_consent true), insert Lead (with raw_payload, utm, source, state, product_id), computeGST, insert Deal. Rely on `deals_open_dedupe` index to catch races (catch unique violation → re-query + return existing link).
- [ ] **Step 7: Payment** — `createPaymentLink` for total; update Deal with link id+url, payment_status='link_sent'.
- [ ] **Step 8: Notify** — `sendEnrollmentLink` (failure logged, not fatal).
- [ ] **Step 9: Return** — `{ success:true, payment_link }`.
- [ ] **Step 10: Gates** — lint + type-check + build (ENV-PENDING: full flow needs live Supabase + keys)
- [ ] **Step 11: Commit** — `git commit -am "feat: ingest pipeline route"`

---

## Workstream 11: admin-records

### Task 11.1: Leads / Deals / Contacts lists + Deal detail

**Files:**
- Create: `app/admin/leads/page.tsx`, `app/admin/deals/page.tsx`, `app/admin/contacts/page.tsx`, `app/admin/deals/[id]/page.tsx`, `src/features/records/queries.ts`

**Interfaces:**
- Consumes: `getServiceClient()`.
- Produces: `searchLeads(filters)`, `listDeals(filters)`, `listContacts(search)`, `getDealTimeline(id)`. Screens per spec §10.

- [ ] **Step 1: queries.ts** — parametric queries with filters (leads: name/phone/email + product/form/status; deals: payment_status + date range; contacts: search).
- [ ] **Step 2: List pages** — design-system tables; filters as query params; tabular numerals on amounts.
- [ ] **Step 3: Deal detail** — full timeline: lead → contact → deal → payment fields → notification_log rows.
- [ ] **Step 4: Gates** — lint + type-check + build
- [ ] **Step 5: Commit** — `git commit -am "feat: admin records lists + deal detail"`

### Task 11.2: CSV export

**Files:**
- Create: `app/api/admin/export/route.ts`

**Interfaces:**
- Consumes: `getServiceClient()`; auth via middleware.
- Produces: `GET /api/admin/export?type=leads|deals&<filters>` returning `text/csv`.

- [ ] **Step 1: Route** — auth-gated; build CSV from filtered rows; set `Content-Disposition: attachment`.
- [ ] **Step 2: Wire buttons** on leads + deals list pages.
- [ ] **Step 3: Gates** — lint + type-check + build
- [ ] **Step 4: Commit** — `git commit -am "feat: CSV export for leads + deals"`

---

## Self-Review Notes

- **Spec coverage:** §3 (all 11 workstreams present), §4 (WS2), §5 (WS6), §6 (WS10), §7 (WS7), §8 (WS8), §9 (WS9), §10 (WS11), §11 design tokens (WS1), §12 security (RLS in WS2, auth WS3, rate-limit/captcha WS10, webhook verify WS8). Covered.
- **Build order dependency:** 1→2→3, then 4 & 5 (need 2,3), 6 (needs 2), 7 (pure), 8 & 9 (need 2,7), 10 (needs 6.1,7,8,9), 11 (needs 2,3). Ingest (10) is last logic piece before records (11).
- **ENV-PENDING (cannot machine-verify until Supabase + live keys provided):** real ingest end-to-end, Razorpay live link + webhook, AiSensy sends, browser form interaction. Each such task builds + type-checks green and is marked ENV-PENDING with a manual test at handover.
- **Types consistency:** `computeGST` return shape (cgst/sgst/igst/taxableAmount/total) consumed identically in ingest Task 10.3. `createPaymentLink` returns {id, short_url} consumed in 10.3 + updated on deal. Binding enum identical across 5.1 and 10.1.
