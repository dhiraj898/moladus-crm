-- 0004_workflow_automation.sql — Workflow Automation (Spec 2). Apply out-of-band.

create table if not exists entry_rules (
  id uuid primary key default gen_random_uuid(),
  condition jsonb,
  to_stage_id uuid not null references stages(id),
  priority integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table entry_rules enable row level security;

create table if not exists stage_actions (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references stages(id) on delete cascade,
  action_type text not null check (action_type in ('send_whatsapp','create_payment_link')),
  config jsonb not null default '{}',
  run_order integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table stage_actions enable row level security;
create index if not exists stage_actions_stage on stage_actions (stage_id, run_order);

create table if not exists sla_rules (
  id uuid primary key default gen_random_uuid(),
  from_stage_id uuid not null references stages(id) on delete cascade,
  delay_minutes integer not null check (delay_minutes > 0),
  condition jsonb,
  action_type text not null check (action_type in ('send_whatsapp','move_stage')),
  config jsonb not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table sla_rules enable row level security;
create index if not exists sla_rules_from_stage on sla_rules (from_stage_id) where active;

create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  sla_rule_id uuid not null references sla_rules(id) on delete cascade,
  stage_entered_at timestamptz not null,
  fired_at timestamptz not null default now()
);
alter table automation_runs enable row level security;
create unique index if not exists automation_runs_once
  on automation_runs (deal_id, sla_rule_id, stage_entered_at);

-- Seed: preserve v1 behaviour. Default entry rule (NULL condition, lowest priority)
-- routes to "Payment Link Sent"; that stage on-enter creates the link + sends the link template.
insert into entry_rules (condition, to_stage_id, priority, active)
  select null, s.id, 1000, true from stages s where s.name = 'Payment Link Sent'
  on conflict do nothing;

insert into stage_actions (stage_id, action_type, config, run_order, active)
  select s.id, 'create_payment_link', '{}'::jsonb, 1, true from stages s where s.name = 'Payment Link Sent'
  union all
  select s.id, 'send_whatsapp', '{"template":"enrollment_link"}'::jsonb, 2, true from stages s where s.name = 'Payment Link Sent';
