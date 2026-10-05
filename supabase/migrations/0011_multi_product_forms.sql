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
