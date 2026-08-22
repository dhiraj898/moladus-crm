-- 0003_crm_depth.sql — CRM Depth (Spec 1). Apply via Supabase SQL editor / db push.

create table if not exists stages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_order integer not null,
  type text not null check (type in ('open','won','lost')) default 'open',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table stages enable row level security;
create unique index if not exists stages_one_default on stages (is_default) where is_default;
create unique index if not exists stages_name_key on stages (name);

insert into stages (name, display_order, type, is_default) values
  ('New', 1, 'open', true),
  ('Call Requested', 2, 'open', false),
  ('Payment Link Sent', 3, 'open', false),
  ('Enrolled', 4, 'won', false),
  ('Closed Lost', 5, 'lost', false)
on conflict (name) do nothing;

alter table deals add column if not exists stage_id uuid references stages(id);
alter table deals add column if not exists owner_id uuid;
alter table deals add column if not exists stage_entered_at timestamptz;
update deals set stage_id = (select id from stages where is_default limit 1),
                stage_entered_at = coalesce(stage_entered_at, now())
  where stage_id is null;
alter table deals drop column if exists stage;

alter table leads add column if not exists owner_id uuid;

create table if not exists deal_stage_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  stage_id uuid not null references stages(id),
  actor_id uuid,
  entered_at timestamptz not null default now()
);
alter table deal_stage_events enable row level security;
create index if not exists deal_stage_events_deal on deal_stage_events (deal_id, entered_at desc);

insert into deal_stage_events (deal_id, stage_id, actor_id, entered_at)
  select d.id, d.stage_id, null, now() from deals d
  where not exists (select 1 from deal_stage_events e where e.deal_id = d.id);

create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('lead','deal','contact')),
  entity_id uuid not null,
  type text not null check (type in ('note','stage_change','created','edited','payment','notification')),
  actor_id uuid,
  body text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table activities enable row level security;
create index if not exists activities_entity on activities (entity_type, entity_id, created_at desc);
