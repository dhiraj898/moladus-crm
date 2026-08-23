-- 0006_custom_fields.sql — Custom Fields (Spec 4). Apply via Supabase SQL editor / db push.

create table if not exists custom_field_defs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('product','lead','deal','contact')),
  key text not null,
  label text not null,
  field_type text not null check (field_type in (
    'short_text','long_text','number','dropdown','radio','checkbox_group','date','yes_no'
  )),
  required boolean not null default false,
  options jsonb not null default '[]',
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table custom_field_defs enable row level security;
create unique index if not exists custom_field_defs_entity_key
  on custom_field_defs (entity_type, key);
create index if not exists custom_field_defs_entity_order
  on custom_field_defs (entity_type, display_order);

alter table products add column if not exists custom_fields jsonb not null default '{}';
alter table leads    add column if not exists custom_fields jsonb not null default '{}';
alter table deals    add column if not exists custom_fields jsonb not null default '{}';
alter table contacts add column if not exists custom_fields jsonb not null default '{}';
