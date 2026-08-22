-- 0001_init.sql — Molecule Enrollment initial schema
--
-- Source of truth: docs/superpowers/specs/2026-08-21-molecule-enrollment-design.md §4.
--
-- APPLY STEP (not applied automatically — no live Supabase project yet):
--   Option A: paste this file into the Supabase SQL editor and run it.
--   Option B: with the Supabase CLI linked to the project, run `supabase db push`.
-- Once the project is connected, regenerate TypeScript types with
--   `supabase gen types typescript --linked > src/lib/supabase/types.ts`
-- (the current src/lib/supabase/types.ts is hand-authored to mirror this schema).
--
-- Security model: every table has RLS ENABLED with NO policies (deny-all).
-- All application access uses the service-role key, which bypasses RLS.

-- Needed for gen_random_uuid()
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
create table products (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  code           text unique,
  sac_code       text,
  description    text,
  base_price     numeric(12, 2) not null,
  currency       text default 'INR',
  taxable        boolean default true,
  gst_percentage numeric(5, 2) default 18.00,
  price_mode     text check (price_mode in ('inclusive', 'exclusive')) default 'exclusive',
  active         boolean default true,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Forms
-- ---------------------------------------------------------------------------
create table forms (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            text unique not null,
  product_id      uuid references products (id),
  status          text check (status in ('draft', 'published')) default 'draft',
  welcome_message text,
  submit_label    text default 'Submit',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- FormFields
-- ---------------------------------------------------------------------------
create table form_fields (
  id            uuid primary key default gen_random_uuid(),
  form_id       uuid references forms (id) on delete cascade,
  key           text not null,       -- machine key, used in binding
  label         text not null,
  field_type    text not null,       -- short_text | long_text | email | phone | number |
                                     -- dropdown | radio | checkbox_group | date | statement | yes_no
  required      boolean default true,
  display_order integer not null,
  options       jsonb,               -- [{label, value}] for dropdown/radio/checkbox_group
  placeholder   text,
  binding       text,                -- contact.name | contact.email | contact.whatsapp_number |
                                     -- contact.marketing_consent | lead.source | lead.state | store_only
  transform     text,                -- string | number | boolean | null
  visible_when  jsonb,               -- null = always visible; {field_key, operator, value}
  unique (form_id, key)
);

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------
create table leads (
  id          uuid primary key default gen_random_uuid(),
  form_id     uuid references forms (id),
  product_id  uuid references products (id),
  name        text,
  email       text,
  phone       text,
  state       text,
  source      text,
  utm         jsonb default '{}',
  status      text default 'new',
  raw_payload jsonb not null,
  created_at  timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------------------------
create table contacts (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid references leads (id),
  name              text,
  email             text,
  whatsapp_number   text unique not null,
  marketing_consent boolean default false,
  consent_timestamp timestamptz,
  tags              text[] default '{}',
  created_at        timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Deals
-- ---------------------------------------------------------------------------
create table deals (
  id                       uuid primary key default gen_random_uuid(),
  lead_id                  uuid references leads (id),
  contact_id               uuid references contacts (id),
  product_id               uuid references products (id),
  base_amount              numeric(12, 2) not null,
  taxable_amount           numeric(12, 2) not null,
  cgst                     numeric(12, 2) default 0,
  sgst                     numeric(12, 2) default 0,
  igst                     numeric(12, 2) default 0,
  total_amount             numeric(12, 2) not null,
  place_of_supply          text,
  stage                    text default 'new',
  payment_status           text check (
                             payment_status in (
                               'pending', 'link_sent', 'link_expired', 'paid', 'failed', 'refunded'
                             )
                           ) default 'pending',
  razorpay_payment_link_id  text,
  razorpay_payment_link_url text,
  razorpay_ref             text,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);

-- Idempotency: at most one OPEN deal per (contact, product). A deal counts as
-- open unless it has reached a terminal payment state.
create unique index deals_open_dedupe
  on deals (contact_id, product_id)
  where payment_status not in ('paid', 'refunded', 'failed');

-- ---------------------------------------------------------------------------
-- NotificationLog
-- ---------------------------------------------------------------------------
create table notification_log (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid references deals (id),
  channel       text default 'whatsapp',
  template      text not null,
  status        text check (status in ('sent', 'failed', 'pending')),
  sent_at       timestamptz,
  error_message text
);

-- ---------------------------------------------------------------------------
-- WebhookEvents (durability + idempotency)
-- ---------------------------------------------------------------------------
create table webhook_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text default 'razorpay',
  event_id     text unique,          -- provider event ID for idempotency
  payload      jsonb not null,
  processed    boolean default false,
  received_at  timestamptz default now(),
  processed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Row Level Security — deny-all on every table.
-- No policies are created, so no role can read or write except the
-- service-role key, which bypasses RLS entirely.
-- ---------------------------------------------------------------------------
alter table products         enable row level security;
alter table forms            enable row level security;
alter table form_fields      enable row level security;
alter table leads            enable row level security;
alter table contacts         enable row level security;
alter table deals            enable row level security;
alter table notification_log enable row level security;
alter table webhook_events   enable row level security;
