# Multi-Product Forms & Bundles — Design

**Date:** 2026-10-05
**Status:** Draft

## Goal
Let one form offer **many** products and bundles. A customer selects several
(cart), checks out once, and that becomes **one order with one combined Razorpay
payment link**. A "bundle" (e.g. `A+B+C – Elite`) is a standalone priced
catalogue item, not a composition with roll-up pricing.

This replaces the current one-form → one-product → one-deal pipeline. The
existing `deals` row **becomes the order**; a new `deal_items` child table holds
the lines. Because `deals` already carries the order-level fields (`total_amount`,
GST totals, `payment_status`, `stage_id`, owner, Razorpay link), the CRM pipeline,
automation/SLA, AiSensy messaging, and the Razorpay webhook keep working at the
deal level with minimal change.

## Decisions (locked 2026-10-05)
- **Selection model:** cart — customer picks multiple items and checks out together.
- **Bundle = standalone priced item:** its own price/GST/description. Stored as a
  `products` row flagged `is_bundle`. The `A+B+C` naming is descriptive; component
  ids are stored only for the authoring helper and a "what's included" display.
- **Checkout:** one order, one combined payment. The **order is the existing
  `deals` row**; lines live in a new `deal_items` table.
- **Form authoring:** explicit per-form list of offered products (many-to-many
  `form_products`), with display order.
- **Bundle authoring:** `is_bundle` flag + a helper that ticks component products +
  tier to prefill name/description; price is set manually.
- **Public form layout:** selection first (with a running total), then the existing
  question fields, then submit.
- **Price/GST snapshotting:** each `deal_items` row snapshots `base_price` and its
  GST split at purchase, so later catalogue edits never alter past orders.

### Out of scope (YAGNI)
- Quantities (every line is qty 1).
- Bundle discount / price roll-up from components.
- Separate `orders` / `order_items` tables parallel to `deals`.
- Multi-currency orders (all lines assume one currency, as today).

## Data model — migration `0011_multi_product_forms.sql`

```sql
-- Products: bundle flag + component references (display/helper only).
alter table products add column is_bundle boolean not null default false;
alter table products add column bundle_components uuid[];   -- nullable; component product ids

-- Form ↔ offered products (many-to-many, ordered).
create table form_products (
  id            uuid primary key default gen_random_uuid(),
  form_id       uuid not null references forms (id) on delete cascade,
  product_id    uuid not null references products (id),
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (form_id, product_id)
);
alter table form_products enable row level security;   -- deny-all; service-role only, matches forms/form_fields

-- Backfill: every existing form with a bound product becomes a 1-item offering.
insert into form_products (form_id, product_id, display_order)
select id, product_id, 0 from forms where product_id is not null;

-- Deals become orders.
alter table deals alter column product_id drop not null;  -- order spans many items
alter table deals add column form_id uuid references forms (id);  -- for order-level dedupe

-- Order line items.
create table deal_items (
  id             uuid primary key default gen_random_uuid(),
  deal_id        uuid not null references deals (id) on delete cascade,
  product_id     uuid not null references products (id),
  product_name   text not null,              -- snapshot at purchase
  base_price     numeric(12, 2) not null,    -- snapshot unit price
  taxable_amount numeric(12, 2) not null,
  cgst           numeric(12, 2) not null default 0,
  sgst           numeric(12, 2) not null default 0,
  igst           numeric(12, 2) not null default 0,
  total_amount   numeric(12, 2) not null,
  created_at     timestamptz not null default now()
);
alter table deal_items enable row level security;   -- deny-all; service-role only
create index deal_items_deal_id on deal_items (deal_id);

-- Dedupe moves from (contact, product) to (contact, form): one open order per
-- customer per form; re-submission resumes it.
drop index if exists deals_open_dedupe;
create unique index deals_open_order_dedupe
  on deals (contact_id, form_id)
  where payment_status not in ('paid', 'refunded', 'failed');
```

Notes:
- `forms.product_id` is retained (not dropped) so old rows/queries don't break,
  but it is **ignored** for new multi-product forms — `form_products` is the
  source of truth. The builder stops writing it.
- `deals.product_id` stays nullable and is left `null` for form-created orders.
  (Line truth is in `deal_items`.) It is kept so the manual single-item path and
  any legacy row remain valid.

## Pricing & GST

- **Per line:** reuse `computeGST(product, customerState)` from
  `src/features/gst/compute.ts` **unchanged** — one call per selected item, giving
  that line's `taxable_amount / cgst / sgst / igst / total`.
- **Aggregate:** new helper `aggregateGST(lines): GSTBreakdown` sums the per-line
  splits with `round2` (paise precision) into the deal's aggregate columns
  (`base_amount`, `taxable_amount`, `cgst`, `sgst`, `igst`, `total_amount`).
- Mixed GST rates and non-taxable items are handled naturally — each line uses its
  own product's rate/`taxable`/`price_mode`.
- **Live form estimate:** `estimatePrice(product)` (from
  `src/features/form-engine/estimate.ts`) per selected item, summed client-side
  into a running total shown above the fields. Preview only (pre-state), as today.

## Public form — `src/app/f/[slug]`

- **Loader** (`forms/queries.ts`): `getPublishedFormBySlug` returns the offered
  products via `form_products` (ordered) instead of a single `product`. New shape:
  `FormWithFields { form, fields, products: Product[] }`. `getFormWithFields`
  (builder) gets the same treatment.
- **FormRunner:** render selection UI **first** — item cards (name, price via
  `estimatePrice`, description), with `is_bundle` items grouped under a "Bundles"
  heading separate from individual products. A running total updates as items are
  toggled. `hide_price` still suppresses prices. Then the existing question fields,
  then submit.
- **Submission payload:** adds `selected_products: string[]` (the chosen product
  ids). Must contain ≥1 id.

## Ingest — `src/app/api/ingest/route.ts`

1. Load form + offered products (`getPublishedFormBySlug`).
2. Validate `selected_products`: non-empty; every id ∈ this form's `form_products`;
   every selected product `active`. Reject otherwise (replaces the current
   `!product` single-product gate).
3. Lead + contact as today (lead's legacy `product_id` left null, or set to the
   first selected id — kept null for clarity).
4. **Dedupe:** `findOpenOrder(contactId, formId)` against the new
   `deals_open_order_dedupe` constraint; resume the existing open order's link if
   present (mirrors today's `resumeOpenDeal`).
5. Compute GST per selected product; `aggregateGST` the lines.
6. Insert **one** `deals` row (the order) with `form_id`, aggregated GST columns,
   `payment_status='pending'`, `product_id=null`; then insert **N** `deal_items`
   rows (snapshotting name/price/line GST).
7. Payment link + actions unchanged — `runCreatePaymentLink` already uses
   `deal.total_amount`; only its `description` changes to an order/form label.
8. Events: `deal.created` / `submission.created` keep firing; `productId` scalar
   becomes a line summary or is dropped from the payload (see Messaging).

## CRM, automation & messaging

- **Deal detail** (`src/app/admin/interest/[id]`): the "Interest" card renders the
  **line-item breakdown** from `deal_items` (name, base, line total) with the
  order aggregate totals (taxable / CGST / SGST / IGST / total) below. Payment card,
  stage history, notifications, WhatsApp thread unchanged. Card title becomes the
  form name (or "N items") instead of a single product name.
- **List / kanban** (`records/queries.ts`, `admin/interest/DealsViews.tsx`): the
  "product" column shows a summary — item count or joined item names. `total_amount`,
  payment chip, stage columns unchanged. Deal search resolves items via `deal_items`.
- **Automation / SLA / Razorpay webhook**: operate purely at the deal level
  (`total_amount`, `payment_status`, link, `stage_id`) → **untouched**.
- **AiSensy `templateParams.ts`:** the `product` token resolves to a line summary
  (joined item names, truncated) instead of one product name. `amount` and
  `payment_link` are already order-level. No new token.

## Admin authoring

- **Product form** (`src/features/products/ProductForm.tsx`, `schema.ts`): add an
  `is_bundle` toggle. When on, a bundle helper lets the admin tick component
  products and a tier (Pro/Elite); ticking prefills `name` (e.g. `A+B+C – Elite`)
  and `description`, and stores the ticked ids in `bundle_components`. Price,
  GST, etc. remain manual product fields.
- **Form builder** (`src/features/forms/*`, `app/admin/forms/[id]`): add a
  "Products offered" multi-select from the active catalogue, re-orderable, writing
  `form_products`. Replaces the single `product_id` picker. Validation: a form
  must offer ≥1 product before it can be **published**.
- **Manual DealForm** (`src/app/admin/interest/DealForm.tsx`): stays single-item,
  but on save also writes **one** `deal_items` row (a 1-line order) so the detail
  view is uniform. Still allowed to leave `form_id` null (manual orders aren't
  deduped by form).

## Validation & edge cases
- Empty cart → ingest rejects (≥1 item required).
- A selected id not offered by the form, or an inactive product → rejected.
- Price/GST on `deal_items` is snapshotted; editing a product later does not change
  existing orders.
- Re-submitting the same form as the same contact resumes the open order (new
  dedupe), returning its existing payment link rather than duplicating.
- Publishing a form with zero offered products is blocked (publish invariant,
  alongside the existing one).

## Testing
- **`aggregateGST`** unit test: mixed rates + a non-taxable line sum to the correct
  aggregate; paise rounding holds (sum of rounded lines, not round-of-sum drift).
- **Ingest** test: a multi-item submission creates one deal + N `deal_items` with
  snapshotted lines and aggregated totals; empty/invalid/inactive selections are
  rejected; re-submission resumes the open order.
- **Bundle helper** test: ticking components + tier prefills name/description and
  stores `bundle_components`.
- Reuse existing `computeGST`, `estimate`, and form/visibility tests as-is.

## Rollout
- Single migration `0011_multi_product_forms.sql` with the backfill, so existing
  published forms keep working as 1-item offerings immediately after deploy.
- No data loss: `forms.product_id` and `deals.product_id` are retained, not dropped.
