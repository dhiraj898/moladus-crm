# Multi-Product Forms & Bundles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is also the input to the `autonomous-build-loop` skill; workstreams (WS) are the self-gating units.

**Goal:** Let one form offer many products/bundles; a customer carts several and checks out once into a single multi-line order with one combined Razorpay payment link.

**Architecture:** The existing `deals` row *becomes the order* (it already holds totals, payment_status, Razorpay link, pipeline stage). A new `deal_items` child table holds the lines (price/GST snapshotted). A `form_products` join lists what each form offers. A bundle is a `products` row flagged `is_bundle`. GST is computed per line with the unchanged `computeGST`, then summed by a new `aggregateGST`. CRM pipeline, automation, messaging, and the Razorpay webhook keep operating at the deal level.

**Tech Stack:** Next.js (App Router, server components + server actions), TypeScript, Supabase (Postgres, service-role client, RLS deny-all), Zod, Vitest, Razorpay SDK, AiSensy.

## Global Constraints

- **GST rate always from the product row**, never hardcoded; every money value rounded to 2 dp (paise) via `round2`. (spec §Pricing)
- **All DB access via the service-role client** (`getServiceClient`); every new table gets `enable row level security` (deny-all), matching `forms`/`form_fields`. Reads live in `*/queries.ts` (`import 'server-only'`), writes in `'use server'` `actions.ts`.
- **Price/GST snapshotted** onto `deal_items` at purchase; later catalogue edits never alter past orders.
- **Never drop** `forms.product_id` or `deals.product_id`; they are retained for back-compat and made nullable/ignored.
- **One migration file** `supabase/migrations/0011_multi_product_forms.sql` (next in sequence after `0010`).
- Gate command for every WS: `npm run lint && npm run type-check && npm run build && npm run test`.
- Commit messages end with the repo's attribution trailer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

## File Structure

**Created:**
- `supabase/migrations/0011_multi_product_forms.sql` — schema: `is_bundle`/`bundle_components`, `form_products`, `deal_items`, `deals.form_id`, nullable `deals.product_id`, new dedupe index.
- `src/features/products/bundle.ts` — pure `buildBundleName` helper (+ test `bundle.test.ts`).
- `src/features/forms/formProducts.ts` — `setFormProducts`/`listFormProductIds` server action + query (or fold into existing files; see tasks).
- `src/features/crm/deals/orderItems.ts` — `buildOrderItems` + `aggregateGST` orchestration used by ingest and manual create (+ test `orderItems.test.ts`).

**Modified (by area):**
- Types: `src/lib/supabase/types.ts` (Product, Form, Deal + new `DealItem`, `FormProduct`).
- GST: `src/features/gst/compute.ts` (`aggregateGST`) + `compute.test.ts`.
- Products: `src/features/products/schema.ts`, `actions.ts`, `ProductForm.tsx`.
- Forms: `src/features/forms/queries.ts`, `actions.ts`, `FormMetaForm.tsx` (+ a products picker), `src/app/admin/forms/[id]/page.tsx`, `new/page.tsx`.
- Public form: `src/app/f/[slug]/page.tsx`, `src/app/f/[slug]/FormRunner.tsx`.
- Ingest: `src/app/api/ingest/route.ts`.
- Automation/messaging: `src/features/crm/automation/runActions.ts`, `sla.ts`.
- CRM read UI: `src/features/records/queries.ts`, `src/app/admin/interest/[id]/page.tsx`, `DealsViews.tsx`, `DealForm.tsx`, `src/features/crm/deals/actions.ts`.

---

## WS1 — Schema & types foundation

Everything depends on this. Lands the migration and the TS row types, plus a back-compat-friendly query shape (`products` array added *alongside* the existing `product`) so later tasks migrate consumers without breaking the build.

### Task 1.1: Migration `0011_multi_product_forms.sql`

**Files:**
- Create: `supabase/migrations/0011_multi_product_forms.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0011_multi_product_forms.sql
-- Multi-product forms, bundles, and multi-line orders.

-- Products: bundle flag + component references (display/helper only; no roll-up).
alter table products add column is_bundle boolean not null default false;
alter table products add column bundle_components uuid[];

-- Form <-> offered products (many-to-many, ordered).
create table form_products (
  id            uuid primary key default gen_random_uuid(),
  form_id       uuid not null references forms (id) on delete cascade,
  product_id    uuid not null references products (id),
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (form_id, product_id)
);
alter table form_products enable row level security;
create index form_products_form_id on form_products (form_id);

-- Backfill: every existing form with a bound product becomes a 1-item offering.
insert into form_products (form_id, product_id, display_order)
select id, product_id, 0 from forms where product_id is not null
on conflict (form_id, product_id) do nothing;

-- Deals become orders.
alter table deals alter column product_id drop not null;
alter table deals add column form_id uuid references forms (id);

-- Order line items (price/GST snapshotted at purchase).
create table deal_items (
  id             uuid primary key default gen_random_uuid(),
  deal_id        uuid not null references deals (id) on delete cascade,
  product_id     uuid not null references products (id),
  product_name   text not null,
  base_price     numeric(12, 2) not null,
  taxable_amount numeric(12, 2) not null,
  cgst           numeric(12, 2) not null default 0,
  sgst           numeric(12, 2) not null default 0,
  igst           numeric(12, 2) not null default 0,
  total_amount   numeric(12, 2) not null,
  created_at     timestamptz not null default now()
);
alter table deal_items enable row level security;
create index deal_items_deal_id on deal_items (deal_id);

-- Dedupe moves from (contact, product) to (contact, form): one open order per
-- customer per form. (Manual deals with null form_id are unaffected — Postgres
-- treats nulls as distinct in a unique index.)
drop index if exists deals_open_dedupe;
create unique index deals_open_order_dedupe
  on deals (contact_id, form_id)
  where payment_status not in ('paid', 'refunded', 'failed');
```

- [ ] **Step 2: Verify SQL parses against local Supabase (if available), else review by eye**

Run (only if a local DB/CLI is configured): `npx supabase db reset --debug` or the project's migrate script.
Expected: migration applies with no error. If no local DB, confirm syntax matches sibling migrations in `supabase/migrations/`. This table-only DDL is ENV-PENDING for live apply (mark so).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0011_multi_product_forms.sql
git commit -m "feat(db): multi-product forms, bundles, order line items (0011)"
```

### Task 1.2: Row types

**Files:**
- Modify: `src/lib/supabase/types.ts` (Product ~153, Form ~170, Deal ~228; add `DealItem`, `FormProduct`)

**Interfaces:**
- Produces: `Product.is_bundle: boolean`, `Product.bundle_components: string[] | null`; `Form` unchanged shape (product_id stays); `Deal.form_id: string | null`; `DealItem`, `FormProduct` row types.

- [ ] **Step 1: Add fields to `Product`**

In `export interface Product`, after `active`:
```typescript
  is_bundle: boolean
  bundle_components: string[] | null
```

- [ ] **Step 2: Add `form_id` to `Deal`**

In `export interface Deal`, after `product_id`:
```typescript
  form_id: string | null
```

- [ ] **Step 3: Add new row types** (end of the table-row section)

```typescript
export interface FormProduct {
  id: string
  form_id: string
  product_id: string
  display_order: number
  created_at: string | null
}

export interface DealItem {
  id: string
  deal_id: string
  product_id: string
  product_name: string
  base_price: number
  taxable_amount: number
  cgst: number
  sgst: number
  igst: number
  total_amount: number
  created_at: string | null
}
```

- [ ] **Step 4: Verify types compile**

Run: `npm run type-check`
Expected: PASS (new optional/added fields don't break existing code; if `Product` literals exist in tests they may need the new fields — fix any such test fixtures in the same commit).

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase/types.ts
git commit -m "feat(types): is_bundle/bundle_components, deal.form_id, DealItem, FormProduct"
```

### Task 1.3: Query shape — add `products` array to form loaders (back-compat)

**Files:**
- Modify: `src/features/forms/queries.ts`

**Interfaces:**
- Produces: `FormWithFields { form; fields; product: Product | null; products: Product[] }` — `products` is the ordered offered catalogue via `form_products`; `product` kept = `products[0] ?? legacy single product` so existing consumers still compile.

- [ ] **Step 1: Add a helper to load offered products**

Add to `queries.ts`:
```typescript
/** Ordered products a form offers (via form_products); falls back to the
 * legacy forms.product_id as a single-item offering when no join rows exist. */
async function loadFormProducts(
  supabase: ReturnType<typeof getServiceClient>,
  form: Form
): Promise<Product[]> {
  const { data: links, error } = await supabase
    .from('form_products')
    .select('product_id, display_order, product:products (*)')
    .eq('form_id', form.id)
    .order('display_order', { ascending: true })
  if (error) throw new Error(`Failed to load form products: ${error.message}`)

  const rows = (links ?? []) as unknown as {
    product: Product | null
  }[]
  const products = rows.map((r) => r.product).filter((p): p is Product => !!p)
  if (products.length > 0) return products

  // Legacy back-compat: a form still using forms.product_id.
  if (form.product_id) {
    const { data: p } = await supabase
      .from('products').select('*').eq('id', form.product_id).maybeSingle()
    if (p) return [p as Product]
  }
  return []
}
```

- [ ] **Step 2: Extend `FormWithFields` and populate `products` in all three loaders**

Change the interface:
```typescript
export interface FormWithFields {
  form: Form
  fields: FormField[]
  product: Product | null
  products: Product[]
}
```
In `getPublishedFormBySlug` and `getFormWithFields`, replace the single-product block with:
```typescript
  const products = await loadFormProducts(supabase, form as Form)
  const product = products[0] ?? null
```
and return `{ form, fields, product, products }`.

- [ ] **Step 3: Verify**

Run: `npm run type-check && npm run build`
Expected: PASS. Existing consumers (`page.tsx`, `ingest/route.ts`) still read `.product` and compile.

- [ ] **Step 4: Commit**

```bash
git add src/features/forms/queries.ts
git commit -m "feat(forms): load offered products array (form_products) alongside legacy product"
```

---

## WS2 — GST aggregation + order-items builder

Pure logic, fully unit-tested. No UI. Independent of WS3–WS8 (depends only on WS1 types).

### Task 2.1: `aggregateGST`

**Files:**
- Modify: `src/features/gst/compute.ts`
- Test: `src/features/gst/compute.test.ts`

**Interfaces:**
- Produces: `aggregateGST(lines: GSTBreakdown[]): GSTBreakdown` — element-wise sum of `cgst/sgst/igst/taxableAmount/total`, each `round2`-ed.

- [ ] **Step 1: Write the failing test**

Append to `compute.test.ts`:
```typescript
import { aggregateGST } from './compute'

describe('aggregateGST', () => {
  it('sums per-line splits with paise rounding', () => {
    const lines = [
      { cgst: 90, sgst: 90, igst: 0, taxableAmount: 1000, total: 1180 },
      { cgst: 0, sgst: 0, igst: 45, taxableAmount: 500, total: 545 },
    ]
    expect(aggregateGST(lines)).toEqual({
      cgst: 90, sgst: 90, igst: 45, taxableAmount: 1500, total: 1725,
    })
  })

  it('handles a non-taxable line (all tax zero)', () => {
    const lines = [{ cgst: 0, sgst: 0, igst: 0, taxableAmount: 299, total: 299 }]
    expect(aggregateGST(lines)).toEqual({
      cgst: 0, sgst: 0, igst: 0, taxableAmount: 299, total: 299,
    })
  })

  it('rounds each accumulated field to 2 dp', () => {
    const lines = [
      { cgst: 0.333, sgst: 0.333, igst: 0, taxableAmount: 3.705, total: 4.371 },
      { cgst: 0.334, sgst: 0.334, igst: 0, taxableAmount: 3.705, total: 4.373 },
    ]
    const r = aggregateGST(lines)
    expect(r.cgst).toBe(0.67)
    expect(r.total).toBe(8.74)
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npm run test -- compute.test.ts`
Expected: FAIL — `aggregateGST is not a function`.

- [ ] **Step 3: Implement**

Append to `compute.ts`:
```typescript
/** Sum per-line GST breakdowns into an order-level aggregate (paise-rounded). */
export function aggregateGST(lines: GSTBreakdown[]): GSTBreakdown {
  const acc = lines.reduce(
    (a, l) => ({
      cgst: a.cgst + l.cgst,
      sgst: a.sgst + l.sgst,
      igst: a.igst + l.igst,
      taxableAmount: a.taxableAmount + l.taxableAmount,
      total: a.total + l.total,
    }),
    { cgst: 0, sgst: 0, igst: 0, taxableAmount: 0, total: 0 }
  )
  return {
    cgst: round2(acc.cgst),
    sgst: round2(acc.sgst),
    igst: round2(acc.igst),
    taxableAmount: round2(acc.taxableAmount),
    total: round2(acc.total),
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test -- compute.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/gst/compute.ts src/features/gst/compute.test.ts
git commit -m "feat(gst): aggregateGST to sum per-line breakdowns into an order total"
```

### Task 2.2: `buildOrderItems` — snapshot lines + aggregate

**Files:**
- Create: `src/features/crm/deals/orderItems.ts`
- Test: `src/features/crm/deals/orderItems.test.ts`

**Interfaces:**
- Consumes: `computeGST`, `aggregateGST`, `round2` (gst/compute), `Product` (types).
- Produces:
  - `OrderItemRow = { product_id; product_name; base_price; taxable_amount; cgst; sgst; igst; total_amount }`
  - `OrderTotals = { base_amount; taxable_amount; cgst; sgst; igst; total_amount }`
  - `buildOrderItems(products: Product[], customerState: string): { items: OrderItemRow[]; totals: OrderTotals }`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { buildOrderItems } from './orderItems'
import type { Product } from '@/lib/supabase/types'

function product(over: Partial<Product>): Product {
  return {
    id: 'p', name: 'A', code: null, sac_code: null, description: null,
    base_price: 1000, currency: 'INR', taxable: true, gst_percentage: 18,
    price_mode: 'exclusive', active: true, is_bundle: false,
    bundle_components: null, custom_fields: {}, created_at: null, updated_at: null,
    ...over,
  }
}

describe('buildOrderItems', () => {
  beforeAll(() => { process.env.BUSINESS_STATE = 'Karnataka' })

  it('snapshots each line and aggregates totals (intra-state)', () => {
    const { items, totals } = buildOrderItems(
      [product({ id: 'a', name: 'A', base_price: 1000 }),
       product({ id: 'b', name: 'B', base_price: 500 })],
      'Karnataka'
    )
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ product_id: 'a', product_name: 'A', base_price: 1000, cgst: 90, sgst: 90, total_amount: 1180 })
    expect(totals).toEqual({ base_amount: 1500, taxable_amount: 1500, cgst: 135, sgst: 135, igst: 0, total_amount: 1770 })
  })

  it('mixes a non-taxable line and an inter-state line', () => {
    const { totals } = buildOrderItems(
      [product({ id: 'a', base_price: 1000 }),
       product({ id: 'c', base_price: 299, taxable: false })],
      'Maharashtra' // inter-state => igst
    )
    expect(totals).toMatchObject({ igst: 180, cgst: 0, sgst: 0, total_amount: 1479 })
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npm run test -- orderItems.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import { computeGST, aggregateGST, round2 } from '@/features/gst/compute'
import type { Product } from '@/lib/supabase/types'

export interface OrderItemRow {
  product_id: string
  product_name: string
  base_price: number
  taxable_amount: number
  cgst: number
  sgst: number
  igst: number
  total_amount: number
}

export interface OrderTotals {
  base_amount: number
  taxable_amount: number
  cgst: number
  sgst: number
  igst: number
  total_amount: number
}

/** Compute snapshotted line items + aggregated order totals for a cart. */
export function buildOrderItems(
  products: Product[],
  customerState: string
): { items: OrderItemRow[]; totals: OrderTotals } {
  const items: OrderItemRow[] = products.map((p) => {
    const g = computeGST(p, customerState)
    return {
      product_id: p.id,
      product_name: p.name,
      base_price: p.base_price,
      taxable_amount: g.taxableAmount,
      cgst: g.cgst,
      sgst: g.sgst,
      igst: g.igst,
      total_amount: g.total,
    }
  })
  const agg = aggregateGST(items)
  const totals: OrderTotals = {
    base_amount: round2(products.reduce((s, p) => s + p.base_price, 0)),
    taxable_amount: agg.taxableAmount,
    cgst: agg.cgst,
    sgst: agg.sgst,
    igst: agg.igst,
    total_amount: agg.total,
  }
  return { items, totals }
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test -- orderItems.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/crm/deals/orderItems.ts src/features/crm/deals/orderItems.test.ts
git commit -m "feat(deals): buildOrderItems to snapshot line items and aggregate order totals"
```

---

## WS3 — Products: bundle flag + authoring helper

Touches only product files. Independent of WS4–WS8.

### Task 3.1: `buildBundleName` pure helper

**Files:**
- Create: `src/features/products/bundle.ts`
- Test: `src/features/products/bundle.test.ts`

**Interfaces:**
- Produces: `buildBundleName(componentNames: string[], tier: string): string` → `"A+B+C - Elite"`; empty tier → just the joined names; empty names → `tier`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { buildBundleName } from './bundle'

describe('buildBundleName', () => {
  it('joins component names with + and appends the tier', () => {
    expect(buildBundleName(['A', 'B', 'C'], 'Elite')).toBe('A+B+C - Elite')
  })
  it('omits the dash when tier is blank', () => {
    expect(buildBundleName(['A', 'B'], '')).toBe('A+B')
  })
  it('returns the tier alone when no components', () => {
    expect(buildBundleName([], 'Pro')).toBe('Pro')
  })
})
```

- [ ] **Step 2: Run it, confirm it fails** — `npm run test -- bundle.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```typescript
/** Build a bundle display name like "A+B+C - Elite" from components + tier. */
export function buildBundleName(componentNames: string[], tier: string): string {
  const names = componentNames.map((n) => n.trim()).filter(Boolean).join('+')
  const t = tier.trim()
  if (!names) return t
  return t ? `${names} - ${t}` : names
}
```

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/products/bundle.ts src/features/products/bundle.test.ts
git commit -m "feat(products): buildBundleName helper for bundle naming"
```

### Task 3.2: Product schema accepts `is_bundle` + `bundle_components`

**Files:**
- Modify: `src/features/products/schema.ts`
- Test: `src/features/products/schema.test.ts` (create if absent)

**Interfaces:**
- Produces: `productSchema` gains `is_bundle: boolean (default false)`, `bundle_components: string[] | null (default null)`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { productSchema } from './schema'

it('parses bundle fields with defaults', () => {
  const r = productSchema.parse({ name: 'A+B - Pro', base_price: 999 })
  expect(r.is_bundle).toBe(false)
  expect(r.bundle_components).toBeNull()
})
it('accepts component ids when is_bundle', () => {
  const ids = ['11111111-1111-1111-1111-111111111111']
  const r = productSchema.parse({ name: 'A+B - Pro', base_price: 999, is_bundle: true, bundle_components: ids })
  expect(r.is_bundle).toBe(true)
  expect(r.bundle_components).toEqual(ids)
})
```

- [ ] **Step 2: Run it, confirm it fails** — FAIL (fields stripped/unknown).

- [ ] **Step 3: Implement** — add to the `productSchema` object (before `custom_fields`):

```typescript
  is_bundle: z.coerce.boolean().default(false),
  bundle_components: z
    .preprocess((v) => (v === '' || v === undefined ? null : v),
      z.array(z.string().uuid()).nullable().default(null)),
```

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/products/schema.ts src/features/products/schema.test.ts
git commit -m "feat(products): schema accepts is_bundle and bundle_components"
```

### Task 3.3: Persist bundle fields in create/update actions

**Files:**
- Modify: `src/features/products/actions.ts` (`createProduct` insert ~89, `updateProduct` update ~155)

- [ ] **Step 1: Include the fields in the insert**

In `createProduct`, the insert currently spreads `productData`. Confirm `productData` (the parsed object minus `custom_fields`) now carries `is_bundle`/`bundle_components`; if the code destructures explicit columns, add `is_bundle` and `bundle_components` to both the insert and the update payloads.

- [ ] **Step 2: Verify**

Run: `npm run type-check && npm run test` — PASS. (No new unit test required; covered by schema test + the UI/manual path. If `actions.ts` has an existing test, extend it to assert the two columns are written.)

- [ ] **Step 3: Commit**

```bash
git add src/features/products/actions.ts
git commit -m "feat(products): persist is_bundle/bundle_components on create and update"
```

### Task 3.4: ProductForm — bundle toggle + helper (browser; ENV-PENDING visual)

**Files:**
- Modify: `src/features/products/ProductForm.tsx`

- [ ] **Step 1: Add an `is_bundle` checkbox** bound to form state, submitted as `is_bundle`.

- [ ] **Step 2: When `is_bundle` is on, render a bundle helper:** a multi-select of other active products (passed in as a `products: Product[]` prop from the page; load via `listProducts()` and exclude the current product), plus a free-text "tier" input (e.g. Pro/Elite). On change, call `buildBundleName(selectedNames, tier)` and prefill the `name` field; set a default description (e.g. the tier text) the admin can edit. Submit the selected ids as `bundle_components`.

- [ ] **Step 3: Wire the page** `src/app/admin/products/new/page.tsx` and `[id]/page.tsx` to pass `products={await listProducts()}` to `ProductForm`.

- [ ] **Step 4: Verify build + lint**

Run: `npm run lint && npm run type-check && npm run build` — PASS.
Visual behaviour (prefill updates, submit persists flag/components) is **ENV-PENDING** (browser). Manual check: create a bundle, tick A+B+C, tier "Elite" → name becomes "A+B+C - Elite"; save; reopen → `is_bundle` on, components retained.

- [ ] **Step 5: Commit**

```bash
git add src/features/products/ProductForm.tsx src/app/admin/products/new/page.tsx src/app/admin/products/[id]/page.tsx
git commit -m "feat(products): bundle toggle + name/description helper in ProductForm"
```

---

## WS4 — Forms: offered-products join + builder

Depends on WS1. Touches form files.

### Task 4.1: `form_products` query + action

**Files:**
- Modify: `src/features/forms/queries.ts` (add `listFormProductIds`)
- Modify: `src/features/forms/actions.ts` (add `setFormProducts`)

**Interfaces:**
- Produces:
  - `listFormProductIds(formId: string): Promise<string[]>` (ordered by display_order) — server-only query.
  - `setFormProducts(formId: string, productIds: string[]): Promise<ActionResult<void>>` — replaces all join rows for the form (delete-all then insert with sequential `display_order`), revalidates `/admin/forms/${formId}`. Requires the `forms.edit` capability like the other form actions.

- [ ] **Step 1: Add the query** to `queries.ts`:

```typescript
export async function listFormProductIds(formId: string): Promise<string[]> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('form_products')
    .select('product_id, display_order')
    .eq('form_id', formId)
    .order('display_order', { ascending: true })
  if (error) throw new Error(`Failed to load form products: ${error.message}`)
  return ((data ?? []) as { product_id: string }[]).map((r) => r.product_id)
}
```

- [ ] **Step 2: Add the action** to `actions.ts` (follow the capability-check + `revalidatePath` pattern used by `upsertField`):

```typescript
export async function setFormProducts(
  formId: string,
  productIds: string[]
): Promise<ActionResult<void>> {
  // (capability check mirroring the other form actions)
  const supabase = getServiceClient()
  const { error: delErr } = await supabase
    .from('form_products').delete().eq('form_id', formId)
  if (delErr) return { ok: false, error: `Failed to update offered products: ${delErr.message}` }
  if (productIds.length > 0) {
    const rows = productIds.map((product_id, i) => ({ form_id: formId, product_id, display_order: i }))
    const { error: insErr } = await supabase.from('form_products').insert(rows)
    if (insErr) return { ok: false, error: `Failed to set offered products: ${insErr.message}` }
  }
  revalidatePath(`/admin/forms/${formId}`)
  revalidatePath('/admin/forms')
  return { ok: true, data: undefined }
}
```

- [ ] **Step 3: Verify** — `npm run type-check && npm run test` — PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/forms/queries.ts src/features/forms/actions.ts
git commit -m "feat(forms): setFormProducts action + listFormProductIds query (form_products join)"
```

### Task 4.2: Publish invariant — require ≥1 offered product

**Files:**
- Modify: `src/features/forms/actions.ts` (`publishForm` ~135)

- [ ] **Step 1: Guard publish**

In `publishForm`, before flipping status to `published`, load the offered products and reject when empty:
```typescript
const offered = await listFormProductIds(id)
if (offered.length === 0) {
  return { ok: false, error: 'Add at least one product before publishing this form.' }
}
```
(Import `listFormProductIds` from `./queries`.)

- [ ] **Step 2: Verify** — `npm run type-check && npm run build` — PASS. If `publishForm` has an existing test, add a case: publishing a form with no offered products returns `{ ok: false }`.

- [ ] **Step 3: Commit**

```bash
git add src/features/forms/actions.ts
git commit -m "feat(forms): block publishing a form with no offered products"
```

### Task 4.3: Form builder — "Products offered" picker (browser; ENV-PENDING visual)

**Files:**
- Modify: `src/app/admin/forms/[id]/page.tsx` (+ `new/page.tsx` if products are editable at create) and the form-meta editor `src/features/forms/FormMetaForm.tsx`

- [ ] **Step 1: Load data** — in the form edit page, `listProducts()` (active) and `listFormProductIds(form.id)`; pass both into the builder UI.

- [ ] **Step 2: Render an orderable multi-select** of active products (checkbox list with up/down ordering, or a two-pane picker). On save, call `setFormProducts(formId, orderedIds)`. Bundles may be labelled with an "Bundle" tag using `product.is_bundle`. Replace the legacy single `product_id` select (leave `forms.product_id` untouched in the DB).

- [ ] **Step 3: Verify build** — `npm run lint && npm run type-check && npm run build` — PASS. Visual/interaction is **ENV-PENDING**. Manual: open a form, tick A, B, "A+B+C - Elite", save; reopen → selection + order persisted; publishing with zero selected is blocked.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/forms/[id]/page.tsx src/app/admin/forms/new/page.tsx src/features/forms/FormMetaForm.tsx
git commit -m "feat(forms): offered-products picker in the form builder"
```

---

## WS5 — Public form: selection-first cart

Depends on WS1 (queries `products`) and WS4. Browser UI → interaction ENV-PENDING; build/lint/type gated.

### Task 5.1: Pass offered products + hide_price to FormRunner

**Files:**
- Modify: `src/app/f/[slug]/page.tsx`

**Interfaces:**
- Produces: `FormRunner` receives `products: ProductOffering[]` and `hidePrice: boolean`, where `ProductOffering = { id; name; description; is_bundle; estimate: { total; gstRate; currency } | null }` computed server-side via `estimatePrice`.

- [ ] **Step 1: Build the offerings** in `PublicFormPage` from `loaded.products`:

```typescript
import { estimatePrice } from '@/features/form-engine/estimate'
// ...
const offerings = loaded.products.map((p) => ({
  id: p.id, name: p.name, description: p.description, is_bundle: p.is_bundle,
  estimate: form.hide_price ? null : estimatePrice(p),
}))
```

- [ ] **Step 2: Replace the single-product header** with a neutral form header (`form.name`) — the per-item prices now live in the selection UI. Pass `products={offerings}` and `hidePrice={form.hide_price}` to `<FormRunner>`.

- [ ] **Step 3: Verify** — `npm run type-check && npm run build` — PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/f/[slug]/page.tsx
git commit -m "feat(form): pass offered products + per-item estimates to FormRunner"
```

### Task 5.2: FormRunner selection screen + running total + `selected_products` in POST

**Files:**
- Modify: `src/app/f/[slug]/FormRunner.tsx`

**Interfaces:**
- Consumes: `products: ProductOffering[]`, `hidePrice: boolean` (new props).
- Produces: POST body gains `selected_products: string[]`.

- [ ] **Step 1: Add props** to `FormRunnerProps`: `products: ProductOffering[]`, `hidePrice: boolean` (define the `ProductOffering` type locally or import a shared one).

- [ ] **Step 2: Add selection state + gate** — `const [selectedIds, setSelectedIds] = useState<string[]>([])`. Render a **selection screen before the field wizard**: item cards (name, description, per-item price from `estimate.total` via `formatMoney`, unless `hidePrice`), bundles grouped under a "Bundles" heading (`is_bundle`), toggles update `selectedIds`, and a sticky running total = sum of selected items' `estimate.total`. A "Continue" button is disabled until `selectedIds.length > 0`; it reveals the existing field wizard. (Keep the existing one-at-a-time field flow unchanged after selection.)

- [ ] **Step 3: Include selection in submit** — in the `fetch` body (~line 151), add `selected_products: selectedIds`.

- [ ] **Step 4: Verify build** — `npm run lint && npm run type-check && npm run build` — PASS. Interaction (toggle, running total, gating, submit payload) is **ENV-PENDING**; manual: open `/f/<slug>`, select 2 items, total sums, continue → fields → submit posts `selected_products`.

- [ ] **Step 5: Commit**

```bash
git add src/app/f/[slug]/FormRunner.tsx
git commit -m "feat(form): selection-first cart with running total; post selected_products"
```

---

## WS6 — Ingest: create a multi-line order

Depends on WS1, WS2, WS4. The pipeline change. Sequence AFTER WS1–WS5 land (shared file: `ingest/route.ts`).

### Task 6.1: Validate selection + dedupe on (contact, form)

**Files:**
- Modify: `src/app/api/ingest/route.ts`

- [ ] **Step 1: Parse `selected_products`** from the body (after `answers`):

```typescript
const selectedProductIds: string[] = Array.isArray(
  (body as { selected_products?: unknown }).selected_products
)
  ? ((body as { selected_products: unknown[] }).selected_products.filter(
      (v): v is string => typeof v === 'string'
    ))
  : []
```

- [ ] **Step 2: Replace the single-product gate** (lines ~234–239). Use `loaded.products` as the offered set; select the carted products from it:

```typescript
const { form, fields, products: offered } = loaded
const offeredById = new Map(offered.map((p) => [p.id, p]))
const selected = selectedProductIds
  .map((id) => offeredById.get(id))
  .filter((p): p is NonNullable<typeof p> => !!p && p.active !== false)
if (selected.length === 0) {
  return fail('Please select at least one item to enrol.', 400)
}
```

- [ ] **Step 3: Switch dedupe to (contact, form)** — replace `findOpenDeal(supabase, contactId, productId)` with:

```typescript
async function findOpenOrder(
  supabase: ReturnType<typeof getServiceClient>,
  contactId: string, formId: string
): Promise<OpenDeal | null> {
  const { data } = await supabase
    .from('deals')
    .select('id, razorpay_payment_link_url, payment_status')
    .eq('contact_id', contactId).eq('form_id', formId)
    .not('payment_status', 'in', '("paid","refunded","failed")')
    .maybeSingle()
  const deal = data as Pick<Deal, 'id' | 'razorpay_payment_link_url'> | null
  return deal ? { id: deal.id, url: deal.razorpay_payment_link_url ?? null } : null
}
```
Update both call sites (step-5 pre-check and the post-insert unique-violation recovery) to pass `form.id`.

- [ ] **Step 4: Verify** — `npm run type-check && npm run build` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ingest/route.ts
git commit -m "feat(ingest): validate carted selection; dedupe open order by (contact, form)"
```

### Task 6.2: Insert order + line items; aggregated GST

**Files:**
- Modify: `src/app/api/ingest/route.ts`

- [ ] **Step 1: Replace the single-product GST + deal insert** (lines ~333–367). Compute order items/totals and insert the deal (with `form_id`, `product_id: null`) then the `deal_items`:

```typescript
import { buildOrderItems } from '@/features/crm/deals/orderItems'
// ...
const customerState = boundLead.state ?? ''
const { items, totals } = buildOrderItems(selected, customerState)
const stageId = await resolveEntryStage(answers)
const now = new Date().toISOString()

const { data: dealRow, error: dealError } = await supabase
  .from('deals')
  .insert({
    lead_id: leadId,
    contact_id: contact.id,
    product_id: null,
    form_id: form.id,
    base_amount: totals.base_amount,
    taxable_amount: totals.taxable_amount,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    total_amount: totals.total_amount,
    place_of_supply: boundLead.state ?? null,
    stage_id: stageId,
    stage_entered_at: now,
    payment_status: 'pending',
  })
  .select('id')
  .single()
```

- [ ] **Step 2: Insert line items** right after the deal row is created (and after the unique-violation recovery block, on the success path, before the stage event):

```typescript
const dealId = (dealRow as Pick<Deal, 'id'>).id
const { error: itemsError } = await supabase
  .from('deal_items')
  .insert(items.map((it) => ({ ...it, deal_id: dealId })))
if (itemsError) {
  return fail('Could not record your order items. Please try again.', 500)
}
```

- [ ] **Step 3: Update the lead insert** (~288) to `product_id: null` (order spans items; the lead no longer binds one product).

- [ ] **Step 4: Update the unique-violation recovery** (~370) to call `findOpenOrder(supabase, contact.id, form.id)`.

- [ ] **Step 5: Update emitted events** (~413–423): drop `productId` from `submission.created`/`deal.created` (or set it to `null`); add `itemCount: items.length` to `deal.created` if the webhook catalog allows extra fields (check `src/features/webhooks/events.ts`; if the payload is strict, just remove `productId`).

- [ ] **Step 6: Verify** — `npm run lint && npm run type-check && npm run build && npm run test` — PASS. End-to-end (live Supabase/Razorpay/AiSensy) is **ENV-PENDING**; manual test script in Task 6.3.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/ingest/route.ts
git commit -m "feat(ingest): create one order + deal_items with aggregated GST"
```

### Task 6.3: Ingest integration test (order creation)

**Files:**
- Test: `src/app/api/ingest/route.test.ts` (extend if present; else add a focused test with the existing Supabase mock pattern used elsewhere in the repo)

- [ ] **Step 1: Write tests** asserting, against the route handler with a mocked service client:
  - a submission selecting 2 offered products inserts ONE `deals` row (`product_id` null, `form_id` set, totals = aggregate) and TWO `deal_items` rows with snapshotted names/prices;
  - empty `selected_products` → 400;
  - a `selected_products` id not in `form_products` (or inactive) → excluded; all-invalid → 400.

  If the repo has no HTTP-handler test harness, implement these as a thin unit test over an extracted helper (`buildOrderItems` is already covered; here assert the *selection filter* + the insert payload shape via the mock). Prefer extending existing patterns over inventing a new harness.

- [ ] **Step 2: Run** — `npm run test -- route.test.ts` — PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/ingest/route.test.ts
git commit -m "test(ingest): multi-line order creation + selection validation"
```

Manual ENV-PENDING end-to-end (append to the route's ENV-PENDING comment): publish a multi-product form; select 2 items; submit → one Razorpay link for the combined total; Supabase shows one `deals` row (product_id null, form_id set, aggregated GST) + two `deal_items`; resubmit same WhatsApp+form before paying → same link, no duplicate order.

---

## WS7 — Automation & messaging at order level

Depends on WS1. **Critical:** without this, orders (null `product_id`) get no payment link, because `runCreatePaymentLink` bails on a missing product. Sequence relative to WS6 either order (independent files), but must land before any live order run.

### Task 7.1: Order-level description + line summary in runActions

**Files:**
- Modify: `src/features/crm/automation/runActions.ts`

**Interfaces:**
- Produces: a helper `orderSummary(dealId): Promise<{ productName: string }>` (or inline) that, when `deal.product_id` is null, reads `deal_items.product_name` for the deal and joins them (e.g. `"A, B, +1 more"`); falls back to the single product's name for legacy deals.

- [ ] **Step 1: Add a line-summary loader**

```typescript
async function loadLineSummary(dealId: string, productId: string | null): Promise<string> {
  const supabase = getServiceClient()
  if (productId) {
    const p = await loadProduct(productId)
    return p?.name ?? 'Order'
  }
  const { data } = await supabase
    .from('deal_items').select('product_name').eq('deal_id', dealId)
  const names = ((data ?? []) as { product_name: string }[]).map((r) => r.product_name)
  if (names.length === 0) return 'Order'
  return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')}, +${names.length - 2} more`
}
```

- [ ] **Step 2: Fix `runCreatePaymentLink`** — remove the hard `if (!product) return` bail. Compute `const description = await loadLineSummary(dealId, deal.product_id)` and pass `description` to `createPaymentLink`. Keep the contact null-guard. (The amount already comes from `deal.total_amount`.)

- [ ] **Step 3: Fix `runSendWhatsApp`** — build `TemplateParamContext.productName` from `loadLineSummary(dealId, deal.product_id)` instead of `product.name`; `amount` and `payment_link` already come off the deal.

- [ ] **Step 4: Verify** — `npm run type-check && npm run build && npm run test` — PASS. If `runActions` has tests, add one: a deal with null product_id and two `deal_items` yields a non-empty description and does not bail.

- [ ] **Step 5: Commit**

```bash
git add src/features/crm/automation/runActions.ts
git commit -m "fix(automation): order-level payment link + WhatsApp summary when product_id is null"
```

### Task 7.2: SLA dispatch uses the line summary

**Files:**
- Modify: `src/features/crm/automation/sla.ts`

- [ ] **Step 1:** In `dispatchSendWhatsApp`, replace the `deal.product_id → product.name` lookup for `productName` with the same line-summary logic (reuse the helper — export `loadLineSummary` from `runActions.ts` or lift it to a shared module `src/features/crm/automation/orderSummary.ts` and import in both). `amount`/`payment_link` already read off the deal.

- [ ] **Step 2: Verify** — `npm run type-check && npm run build && npm run test` — PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/crm/automation/sla.ts src/features/crm/automation/runActions.ts
git commit -m "fix(automation): SLA WhatsApp uses order line summary"
```

---

## WS8 — CRM read UI: line-item breakdown + list summary

Depends on WS1. Touches records/queries + interest pages. Sequence after WS6 for meaningful data, but code-independent.

### Task 8.1: Load deal items in the timeline

**Files:**
- Modify: `src/features/records/queries.ts` (`getDealTimeline` ~967, `DealTimeline` ~948)

**Interfaces:**
- Produces: `DealTimeline` gains `items: DealItem[]` (ordered by `created_at`).

- [ ] **Step 1:** Add `items:deal_items (*)` to the `getDealTimeline` select string, and `items: DealItem[]` to the `DealTimeline` interface + the returned object. Map the nested rows.

- [ ] **Step 2: Verify** — `npm run type-check && npm run build` — PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/records/queries.ts
git commit -m "feat(records): include deal_items in the deal timeline"
```

### Task 8.2: Deal detail renders line items (browser; ENV-PENDING visual)

**Files:**
- Modify: `src/app/admin/interest/[id]/page.tsx`

- [ ] **Step 1:** In the "Interest" card, when `items.length > 0`, render a line table (product_name, base_price, line total) above the aggregate totals (taxable / CGST / SGST / IGST / total from the deal). Title the card `product?.name ?? form name ?? 'Order'`. Keep the single-product rendering as a fallback when `items` is empty (legacy deals).

- [ ] **Step 2: Verify build** — `npm run lint && npm run type-check && npm run build` — PASS. Visual ENV-PENDING. Manual: open an order → see each line + aggregate totals.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/interest/[id]/page.tsx
git commit -m "feat(interest): render order line items on the deal detail page"
```

### Task 8.3: List/kanban product column shows an order summary

**Files:**
- Modify: `src/features/records/queries.ts` (`DEAL_SELECT` ~354, `toDealListItem` ~453, `DealListItem` ~347), `src/app/admin/interest/DealsViews.tsx` (~134/165)

- [ ] **Step 1:** Add `items:deal_items (product_name)` to `DEAL_SELECT`; extend `DealListItem` with `item_names: string[]`; populate in `toDealListItem`. In `DealsViews.tsx`, render the product column as: the single `product?.name` when present, else a summary of `item_names` (first 1–2 names + "+N") or `"N items"` when empty.

- [ ] **Step 2:** Confirm `resolveDealSearchIds` still works; optionally extend it to match `deal_items.product_name` (nice-to-have — skip if it widens scope).

- [ ] **Step 3: Verify** — `npm run lint && npm run type-check && npm run build && npm run test` — PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/records/queries.ts src/app/admin/interest/DealsViews.tsx
git commit -m "feat(interest): show order item summary in deal list/kanban"
```

### Task 8.4: Manual DealForm writes a single-line order

**Files:**
- Modify: `src/features/crm/deals/actions.ts` (`createDeal`, `updateDeal`)

- [ ] **Step 1:** In `createDeal`, after the deal row is inserted, also insert ONE `deal_items` row snapshotting the chosen product (`product_name`, `base_price`, and the computed per-line GST = the same `computeGST` result already used for the deal totals). Keep `deals.product_id` set (manual single-item deals keep it; `form_id` stays null → not deduped by form). In `updateDeal`, when the product changes, replace the single `deal_items` row for that deal.

- [ ] **Step 2: Verify** — `npm run type-check && npm run build && npm run test` — PASS. Extend any existing `createDeal` test to assert one `deal_items` row is written.

- [ ] **Step 3: Commit**

```bash
git add src/features/crm/deals/actions.ts
git commit -m "feat(deals): manual create/edit writes a single-line deal_items row"
```

---

## Dependency order & parallelism (for the build loop)

Sequence (shared-file units never parallel):
1. **WS1** (foundation) — must be first.
2. **WS2**, **WS3** — independent of each other and of WS4+; may run in parallel (different files).
3. **WS4** (forms) — after WS1.
4. **WS5** (public form) — after WS4 (+WS1).
5. **WS6** (ingest) — after WS1, WS2, WS4; its tasks are sequential (same file).
6. **WS7** (automation) — after WS1; independent files from WS6, but must land before any live order.
7. **WS8** (CRM read) — after WS1 (data from WS6 for manual verification); tasks touch shared `records/queries.ts` → sequential within WS8.

Each WS self-gates on `npm run lint && npm run type-check && npm run build && npm run test`; commit only on green, revert otherwise.

## Self-review notes
- **Spec coverage:** is_bundle+helper (WS3), form_products many-to-many + builder (WS4), selection-first cart + running total (WS5), deal=order + deal_items + aggregated GST + (contact,form) dedupe (WS1/WS2/WS6), order-level payment link/messaging (WS7), deal-detail line items + list summary + manual single-line order (WS8), backfill + retained columns (WS1). All spec sections map to a task.
- **Snapshotting:** `deal_items` carries `product_name`/`base_price`/line GST, set once at WS2/WS6/WS8 insert time — later product edits don't alter orders.
- **Critical coupling:** WS7 removes the `!product` bail so null-product orders still mint a link — called out explicitly.
- **Back-compat:** `products` added alongside `product` in WS1.3 so each task builds green; consumers migrate in WS5/WS6/WS8; `forms.product_id`/`deals.product_id` retained.
- **ENV-PENDING** (no machine gate; hand over manual scripts): live migration apply (1.1), ProductForm helper (3.4), form builder picker (4.3), FormRunner selection (5.x), ingest end-to-end (6.x), deal-detail/list rendering (8.2/8.3).
