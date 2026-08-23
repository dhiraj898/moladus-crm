-- 0008_messages.sql — AiSensy WhatsApp conversation capture (Spec 6). Apply out-of-band.

create table if not exists messages (
  id                 uuid primary key default gen_random_uuid(),
  contact_id         uuid references contacts(id) on delete set null,
  aisensy_message_id text not null unique,
  direction          text not null check (direction in ('inbound','outbound')),
  sender             text,
  body               text,
  message_type       text,
  phone_number       text,
  raw                jsonb not null default '{}',
  sent_at            timestamptz,
  created_at         timestamptz not null default now()
);
alter table messages enable row level security;
create index if not exists messages_contact_sent on messages (contact_id, sent_at);
create index if not exists messages_phone_sent   on messages (phone_number, sent_at);
