# Molecule Enrollment App — Design Spec
**Date:** 2026-08-21  
**Status:** Approved  
**Source:** PRD v0.3 + design decisions made 2026-08-21

---

## 1. Problem & Goal

Replace the YouForm → n8n → Zoho → Razorpay → AiSensy pipeline with a single owned app.  
Core payoff: launch a new product + live enrollment form in one admin action, with explicit debuggable field bindings and full data ownership.

---

## 2. Decided Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js 15 App Router | One Railway deploy; Server Actions + route handlers keep secrets server-side by default |
| DB + Auth | Supabase (Postgres + Auth) | Managed Postgres, Auth built-in for admin |
| Hosting | Railway | Single deploy, env var secrets, webhook-ready |
| Payments | Razorpay hosted checkout | Reuse what Razorpay already does; no payment-link lifecycle to own |
| WhatsApp | AiSensy (server-side only) | Transactional v1; promotional deferred |
| Language | TypeScript | Type-safe DB queries, field binding maps, GST computation |
| Styling | Tailwind CSS + design system tokens | Inter only, dark-default, `--accent:#ff4500` per Moladus design language |

**Data ownership:** Option A — app is the system of record. Zoho sync deferred.  
**Cart:** One product per form (one `product_id` per Deal). No line items in v1.  
**Form logic:** Full YouForm parity — one-at-a-time UX + conditional show/hide rules.

---

## 3. Architecture

```
Railway (Next.js App Router)
├── /f/[slug]                    Public form — SSR, no client secrets
├── /api/ingest                  POST; rate-limited, CAPTCHA-protected
├── /api/webhooks/razorpay       Razorpay payment_link.paid — signature verified
└── /admin/*                     Supabase Auth-protected
    ├── /admin/products          Product CRUD
    ├── /admin/forms             Form list + create
    ├── /admin/forms/[id]        Field configurator
    ├── /admin/leads             Lead list + search
    ├── /admin/deals             Deal list + detail
    └── /admin/contacts          Contact list
```

**Key security guarantees:**
- All Supabase access via **service-role key** from Railway — never from the browser.
- RLS on all tables, deny-all default. Service-role bypasses RLS.
- Razorpay + AiSensy keys in Railway env vars only.
- Public form page renders field config server-side — no client round-trip for field definitions.
- Webhook durability: raw Razorpay event written to `webhook_events` table before processing.

---

## 4. Data Model

### Products
```sql
id uuid PK
name text NOT NULL
code text UNIQUE
sac_code text
description text
base_price numeric(12,2) NOT NULL
currency text DEFAULT 'INR'
taxable boolean DEFAULT true
gst_percentage numeric(5,2) DEFAULT 18.00
price_mode text CHECK (price_mode IN ('inclusive','exclusive')) DEFAULT 'exclusive'
active boolean DEFAULT true
created_at timestamptz DEFAULT now()
updated_at timestamptz DEFAULT now()
```

### Forms
```sql
id uuid PK
name text NOT NULL
slug text UNIQUE NOT NULL
product_id uuid REFERENCES products(id)
status text CHECK (status IN ('draft','published')) DEFAULT 'draft'
welcome_message text
submit_label text DEFAULT 'Submit'
created_at timestamptz DEFAULT now()
updated_at timestamptz DEFAULT now()
```

### FormFields
```sql
id uuid PK
form_id uuid REFERENCES forms(id) ON DELETE CASCADE
key text NOT NULL           -- machine key, used in binding
label text NOT NULL
field_type text NOT NULL    -- see Field Types below
required boolean DEFAULT true
display_order integer NOT NULL
options jsonb               -- [{label, value}] for dropdown/radio/checkbox
placeholder text
binding text                -- 'contact.name' | 'contact.email' | 'contact.whatsapp_number' | 'contact.marketing_consent' | 'lead.source' | 'lead.state' | 'store_only'
transform text              -- 'string' | 'number' | 'boolean' | null
visible_when jsonb          -- null = always visible; see Conditional Logic below
UNIQUE(form_id, key)
```

**Field types:** `short_text`, `long_text`, `email`, `phone`, `number`, `dropdown`, `radio`, `checkbox_group`, `date`, `statement`, `yes_no`

**visible_when shape:**
```json
{
  "field_key": "course_type",
  "operator": "eq" | "neq" | "in" | "not_in",
  "value": "online"
}
```
For `in`/`not_in`, value is an array of strings.

### Leads
```sql
id uuid PK
form_id uuid REFERENCES forms(id)
product_id uuid REFERENCES products(id)
name text
email text
phone text
state text
source text
utm jsonb DEFAULT '{}'
status text DEFAULT 'new'
raw_payload jsonb NOT NULL
created_at timestamptz DEFAULT now()
```

### Contacts
```sql
id uuid PK
lead_id uuid REFERENCES leads(id)
name text
email text
whatsapp_number text UNIQUE NOT NULL
marketing_consent boolean DEFAULT false
consent_timestamp timestamptz
tags text[] DEFAULT '{}'
created_at timestamptz DEFAULT now()
```

### Deals
```sql
id uuid PK
lead_id uuid REFERENCES leads(id)
contact_id uuid REFERENCES contacts(id)
product_id uuid REFERENCES products(id)
base_amount numeric(12,2) NOT NULL
taxable_amount numeric(12,2) NOT NULL
cgst numeric(12,2) DEFAULT 0
sgst numeric(12,2) DEFAULT 0
igst numeric(12,2) DEFAULT 0
total_amount numeric(12,2) NOT NULL
place_of_supply text
stage text DEFAULT 'new'
payment_status text CHECK (payment_status IN ('pending','link_sent','link_expired','paid','failed','refunded')) DEFAULT 'pending'
razorpay_payment_link_id text
razorpay_payment_link_url text
razorpay_ref text
created_at timestamptz DEFAULT now()
updated_at timestamptz DEFAULT now()
```

**Idempotency constraint:**
```sql
CREATE UNIQUE INDEX deals_open_dedupe 
ON deals(contact_id, product_id) 
WHERE payment_status NOT IN ('paid','refunded','failed');
```

### NotificationLog
```sql
id uuid PK
deal_id uuid REFERENCES deals(id)
channel text DEFAULT 'whatsapp'
template text NOT NULL
status text CHECK (status IN ('sent','failed','pending'))
sent_at timestamptz
error_message text
```

### WebhookEvents (durability)
```sql
id uuid PK
provider text DEFAULT 'razorpay'
event_id text UNIQUE     -- Razorpay event ID for idempotency
payload jsonb NOT NULL
processed boolean DEFAULT false
received_at timestamptz DEFAULT now()
processed_at timestamptz
```

---

## 5. Form Engine (YouForm Parity)

### UX
- One field per screen, full-height layout
- Progress bar at top (fields answered / total visible fields)
- Animated transitions: field exits slide-up + fade-out, next field slides in from below (~0.3s, ease-out)
- Keyboard: Enter advances, Backspace on empty field goes back
- Mobile: tap-anywhere-on-field to focus, swipe-up to advance (optional, keyboard is primary)
- Back button: always visible except on first field
- Counter: "3 of 7" top-right
- Statement fields (no input): just a "Continue" button, no input element
- Yes/No fields: two large tap targets, auto-advance on tap

### Conditional Logic (client)
- On each field answer, re-evaluate all `visible_when` rules for subsequent fields
- Hidden fields are skipped in navigation; progress bar count only counts visible fields
- Rule evaluation is pure JS on the client-collected answers map

### Conditional Logic (server — spoofing protection)
- On ingest, re-evaluate all `visible_when` rules using the submitted answers
- Strip any field values for fields that evaluate as hidden
- Validate only non-hidden, required fields

---

## 6. Submission Pipeline (ingest endpoint)

`POST /api/ingest`

```
1. Rate limit: 5 req/min per IP (Upstash Redis or in-memory for v1)
2. CAPTCHA verify (hCaptcha — free tier, no JS SDK on form page; server-side verify)
3. Parse form_id + field answers from body
4. Load FormField definitions for form_id (cached)
5. Server-side visibility evaluation → strip hidden fields
6. Validate required fields + type coercion
7. Apply bindings → extract contact fields, lead fields, store-only fields
8. Idempotency check: SELECT deal WHERE contact.whatsapp_number = ? AND product_id = ? AND payment_status NOT IN (paid, refunded, failed)
   → if exists, return existing deal's payment link
9. BEGIN transaction:
   a. Upsert Contact (by whatsapp_number); record consent + timestamp
   b. Insert Lead
   c. Compute GST amounts (see §7)
   d. Insert Deal (linked to lead + contact + product)
10. Create Razorpay payment link for Deal.total_amount
11. Update Deal with razorpay_payment_link_id + url; set payment_status = 'link_sent'
12. Fire AiSensy WhatsApp (template: enrollment_link) with payment link
13. Insert NotificationLog row
14. Return { success: true, payment_link: url }
```

---

## 7. GST Computation

Business registered state stored in env var `BUSINESS_STATE` (e.g. `"MH"`).

```typescript
function computeGST(product: Product, customerState: string): GSTBreakdown {
  if (!product.taxable) return { cgst: 0, sgst: 0, igst: 0, taxableAmount: product.base_price, total: product.base_price }
  
  const rate = product.gst_percentage / 100
  let base: number
  
  if (product.price_mode === 'exclusive') {
    base = product.base_price
  } else {
    // inclusive: extract base from total
    base = round2(product.base_price / (1 + rate))
  }
  
  const total = product.price_mode === 'exclusive' ? round2(base * (1 + rate)) : product.base_price
  const taxAmount = round2(total - base)
  
  const intraState = customerState === process.env.BUSINESS_STATE
  
  return intraState
    ? { cgst: round2(taxAmount / 2), sgst: round2(taxAmount / 2), igst: 0, taxableAmount: base, total }
    : { cgst: 0, sgst: 0, igst: taxAmount, taxableAmount: base, total }
}

const round2 = (n: number) => Math.round(n * 100) / 100
```

---

## 8. Razorpay Integration

- **Payment link creation:** `POST /v1/payment_links` with `amount` (paise), `currency: INR`, `description`, customer name+email+contact, `callback_url` = `/f/[slug]/thank-you`
- **Webhook:** `POST /api/webhooks/razorpay` — verify `X-Razorpay-Signature` (HMAC-SHA256 of raw body with webhook secret) before any processing
- **Flow on `payment_link.paid`:**
  1. Write raw event to `webhook_events` (idempotent via `event_id`)
  2. Find Deal by `razorpay_payment_link_id`
  3. Update `payment_status = 'paid'`, set `razorpay_ref`
  4. Fire AiSensy receipt WhatsApp
  5. Mark `webhook_events.processed = true`
- **Expired/failed:** handled via separate `payment_link.expired` and `payment_link.cancelled` events → set appropriate status

---

## 9. AiSensy Integration

Server-side only. Key in `AISENSY_API_KEY` env var.

**Templates (v1):**
- `enrollment_link` — fires on submission; carries student name + payment link
- `enrollment_receipt` — fires on `paid`; carries student name + amount + product name

Each send:
1. POST to AiSensy API with template + parameters
2. Insert `NotificationLog` row with `status: 'sent'` or `status: 'failed'` + error message
3. Log failure, never crash the ingest pipeline on notification failure

---

## 10. Admin Console

All routes under `/admin/*`, protected by Supabase Auth middleware.

| Screen | Key actions |
|---|---|
| Products list | List, activate/deactivate, create new |
| Product form | Create/edit all product fields |
| Forms list | List by product, status filter, copy link |
| Form builder | Add/reorder/delete fields; set type/label/key/required/options/binding/visible_when |
| Leads list | Search by name/phone/email, filter by product/form/status |
| Deals list | Filter by payment_status, date range |
| Deal detail | Full timeline: lead → contact → deal → payment events → notifications |
| Contacts list | Search, view linked deals |
| CSV export | Leads + deals per filter set |

---

## 11. Design System

Follows Moladus Artifact Style Guide (2026-08-21):
- Inter via rsms.me (app context) or Google Fonts (Artifact context)
- Dark default: `--bg:#0a0a0a`, `--accent:#ff4500`
- Light: toggled via `html.light` class or auto `prefers-color-scheme`
- All colors via CSS variables, zero hardcoded hex in component rules
- Tailwind config extended with design tokens

Public form uses full-bleed dark layout matching the design system.  
Admin uses the same tokens in a sidebar + content layout.

---

## 12. Security

- Service-role key: Railway env only, never in client bundle
- Admin auth: Supabase Auth, pre-created accounts only (no self-registration)
- Rate limit on `/api/ingest`: 5 req/min per IP
- CAPTCHA on ingest: hCaptcha server-side verify
- Razorpay webhook signature: reject any request where HMAC-SHA256 doesn't match
- RLS: deny-all on all tables; service-role bypasses for all app DB access
- PII: names/emails/phones stored; DPDP Act obligations in scope (consent captured, purpose-limited)

---

## 13. Environment Variables

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Razorpay
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

# AiSensy
AISENSY_API_KEY=

# hCaptcha
HCAPTCHA_SECRET=
NEXT_PUBLIC_HCAPTCHA_SITE_KEY=

# Business
BUSINESS_STATE=MH

# App
NEXT_PUBLIC_APP_URL=https://your-railway-domain.up.railway.app
```

---

## 14. Workstreams (Build Order)

1. **scaffold** — Next.js 15 + TypeScript + Tailwind + ESLint + Prettier + env + git
2. **db** — Supabase schema migrations (all tables, indexes, RLS policies), generated types
3. **admin-auth** — Supabase Auth middleware, `/admin` protection, login page
4. **product-master** — Product CRUD admin screens
5. **form-configurator** — Form CRUD + field configurator (admin)
6. **form-engine** — Public form UX: one-at-a-time, transitions, conditional logic, progress bar
7. **ingest** — `POST /api/ingest`: rate-limit, CAPTCHA, validate, bind, idempotency, Lead+Contact+Deal creation
8. **gst** — GST computation module + unit tests
9. **razorpay** — Payment link creation + webhook handler + deal status updates
10. **aisensy** — WhatsApp sends + NotificationLog
11. **admin-records** — Leads/Deals/Contacts list + Deal detail + CSV export

**Gates per workstream:** `npm run lint && npm run type-check && npm run build`  
(Unit tests added incrementally — GST module gets tests in workstream 8)

---

## 15. Open (post-v1)

- Compliant GST invoice (v1.5)
- Unpaid-deal reminder WA message (v1.5)
- Admin dashboard with charts
- Refunds
- Visual drag-drop form builder
- Promotional WhatsApp + segmentation
- Zoho sync (optional)
