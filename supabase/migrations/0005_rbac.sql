-- 0005_rbac.sql — RBAC (Spec 3). Apply out-of-band. First of specs 3–6.
-- Assignment reuses the existing leads.owner_id / deals.owner_id (migration 0003);
-- no columns are added to leads/deals here.

create table if not exists roles (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null unique,
  permissions        jsonb not null default '{}',
  in_assignment_pool boolean not null default false,
  is_system          boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table roles enable row level security;

create table if not exists profiles (
  user_id    uuid primary key,
  role_id    uuid references roles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table profiles enable row level security;
create index if not exists profiles_role on profiles (role_id);

create table if not exists assignment_state (
  key          text primary key,
  last_user_id uuid,
  updated_at   timestamptz not null default now()
);
alter table assignment_state enable row level security;

-- Seed: full-permission Admin role (non-deletable). Guarded.
insert into roles (name, permissions, in_assignment_pool, is_system)
values (
  'Admin',
  '{
    "products":  {"view": true, "edit": true},
    "forms":     {"view": true, "edit": true},
    "leads":     {"view": true, "edit": true, "scope": "all"},
    "deals":     {"view": true, "edit": true, "scope": "all"},
    "contacts":  {"view": true, "edit": true},
    "settings":  {"view": true, "edit": true},
    "automation":{"view": true, "edit": true}
  }'::jsonb,
  false,
  true
)
on conflict (name) do nothing;

-- Seed: starter Agent role — own-scope leads/deals, in the assignment pool. Guarded.
insert into roles (name, permissions, in_assignment_pool, is_system)
values (
  'Agent',
  '{
    "products":  {"view": false, "edit": false},
    "forms":     {"view": false, "edit": false},
    "leads":     {"view": true, "edit": true, "scope": "own"},
    "deals":     {"view": true, "edit": true, "scope": "own"},
    "contacts":  {"view": true, "edit": false},
    "settings":  {"view": false, "edit": false},
    "automation":{"view": false, "edit": false}
  }'::jsonb,
  true,
  false
)
on conflict (name) do nothing;

-- Seed: round-robin cursor singleton. Guarded.
insert into assignment_state (key, last_user_id)
values ('round_robin', null)
on conflict (key) do nothing;

-- Seed: bootstrap admin. Best-effort — assigns 0 rows if the auth user does not
-- yet exist; re-run the manual snippet in the spec (§11) after first sign-up. Guarded.
insert into profiles (user_id, role_id)
select u.id, r.id
from auth.users u
cross join roles r
where u.email = 'ghosaldhiraj@gmail.com' and r.name = 'Admin'
on conflict (user_id) do nothing;
