-- 0010_outbound_webhooks.sql — outbound event webhooks (Spec B). Apply out-of-band.
-- Two tables: webhook_endpoints (registered URLs + encrypted HMAC secret) and
-- webhook_deliveries (durable retry queue). Both RLS deny-all (no policies) —
-- access is service-role only via server-only modules.

create table if not exists webhook_endpoints (
  id         uuid primary key default gen_random_uuid(),
  url        text not null,
  events     text[] not null default '{}',
  secret_enc text not null,               -- AES-GCM (Spec A crypto)
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);
alter table webhook_endpoints enable row level security;

create table if not exists webhook_deliveries (
  id              uuid primary key default gen_random_uuid(),
  endpoint_id     uuid not null references webhook_endpoints(id) on delete cascade,
  event           text not null,
  payload         jsonb not null,
  status          text not null check (status in ('pending','delivered','failed')) default 'pending',
  attempts        integer not null default 0,
  max_attempts    integer not null default 5,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  response_code   integer,
  error           text,
  created_at      timestamptz not null default now()
);
alter table webhook_deliveries enable row level security;

create index if not exists webhook_deliveries_due
  on webhook_deliveries (next_attempt_at) where status = 'pending';
create index if not exists webhook_deliveries_endpoint
  on webhook_deliveries (endpoint_id, created_at desc);
