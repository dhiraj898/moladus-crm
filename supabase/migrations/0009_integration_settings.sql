-- 0009_integration_settings.sql — encrypted provider secrets (Spec A). Apply out-of-band.
create table if not exists integration_settings (
  key        text primary key,
  value_enc  text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table integration_settings enable row level security;
