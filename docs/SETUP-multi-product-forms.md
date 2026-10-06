# Multi-Product Forms & Bundles — Setup (one pager)

## 1. Apply the database migration

Links the CLI to the project, then pushes migration `0011`.

```bash
supabase link --project-ref pxtwovbueddnjwwifbmz   # prompts for DB password
supabase db push
```

**If `db push` lists ALL migrations (0001–0011)** — the remote history isn't tracked.
Mark the old ones as applied, then push again (applies only new ones):

```bash
supabase migration repair --status applied 0001 0002 0003 0004 0005 0006 0007 0008 0009 0010
supabase db push        # now applies only 0011
```

`0011` adds: `form_products`, `deal_items`, `products.is_bundle`/`bundle_components`,
`deals.form_id`, makes `deals.product_id` nullable, swaps the dedupe index to
(contact, form). No data is dropped. Backfills `form_products` from existing forms.

Verify: `supabase migration list` → `0011` shows under both Local and Remote.

## 2. Deploy the app

Merge PR **#20** (`feat/multi-product-forms` → `main`) on
`github.com/dhiraj898/moladus-crm`. Railway deploys from `main` on merge.

## 3. Create products & bundles  (Admin → Products)

- **Product:** New product → name, price, GST%, SAC. Save.
- **Bundle:** New product → tick **This is a bundle** → tick component products
  (A, B, C) + type a **tier** (e.g. `Elite`) → name auto-fills `A+B+C - Elite` →
  set the bundle's own price. Save.

## 4. Build a multi-product form  (Admin → Forms)

1. New form → name, slug, questions (as before).
2. In **Products offered**, add the products/bundles this form sells; drag to order.
3. **Publish** (blocked until ≥1 product is added).

## 5. Test the customer flow

Open `/f/<slug>`:
- Select one or more items → running total updates.
- Continue → answer questions → submit.
- Result: **one order** with **one Razorpay link** for the combined total.

Check in Admin → Interests: the order shows its **line items** + aggregated GST.

## Notes

- A bundle is just a priced catalogue item; its component list is for naming +
  "what's included" display only (no price roll-up).
- Re-submitting the same WhatsApp number on the same form resumes the open order
  (returns the same payment link) instead of creating a duplicate.
- Spec: `docs/superpowers/specs/2026-10-05-multi-product-forms-and-bundles-design.md`
- Plan: `docs/superpowers/plans/2026-10-05-multi-product-forms-and-bundles.md`
