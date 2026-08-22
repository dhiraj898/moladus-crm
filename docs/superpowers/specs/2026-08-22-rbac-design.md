# Spec 3 — RBAC (Role-Based Access Control) — Design

**Date:** 2026-08-22
**Status:** Draft (awaiting review)
**Phase:** 3 of 6 in the roadmap. First of specs 3–6 (migration `0005`). Builds on Spec 1 (CRM Depth: `stages`, `deals.stage_id`/`owner_id`, `leads.owner_id`, `activities`) and Spec 2 (Workflow Automation: the ingest reshape, `runStageActions`). Does **not** depend on migrations 0006/0007/0008.

---

## 1. Goal

Give the admin a way to define **who can see and do what**, module by module, without hard-coding a fixed set of roles. An admin creates named roles, each carrying a per-module permission matrix (view / edit) and, for the record modules (leads, deals), a scope of `all` vs `own`. Users (Supabase Auth users) are mapped to exactly one role. New inbound submissions are auto-distributed to an eligible pool of users by round-robin, and any user who can edit a record may reassign it manually.

Enforcement is **application-level**: every DB path runs through the service-role client (RLS is deny-all as a backstop), so authorization lives in the app — admin section gates, per-action permission re-checks, and scope-filtered queries.

Modeled as **custom per-module permissions**, NOT a fixed `admin | agent | viewer` enum. This mirrors the codebase's existing "config is data in a few tables, interpreted by small deterministic helpers" pattern (Stages, Automation).

---

## 2. Scope

**In scope**
- **Roles** — CRUD over a `roles` table; each role has a `permissions` JSONB matrix + an `in_assignment_pool` flag.
- **Permission matrix** — per module (`products, forms, leads, deals, contacts, settings, automation`): `view` + `edit` booleans; for `leads` and `deals` additionally a `scope` of `all | own`.
- **User → role mapping** — a `profiles` table (`auth.users.id → role_id`).
- **Permission helpers** — `getCurrentUserWithRole()`, pure `can()` / `scopeFor()` / `ownerScopeFilter()`, and an action guard `requirePermission()`.
- **Route/section gating** — admin section layouts gate `products / forms / settings / automation` by `view`; `AdminNav` / `SettingsNav` hide links the user cannot open.
- **Scope-filtered reads** — leads & deals list/detail queries filter by `owner_id` when the role's scope is `own`.
- **Action enforcement** — every mutating server action re-checks the relevant module `edit` permission (and, for `own` scope, record ownership).
- **Assignment** — auto round-robin on new ingest (stamps `owner_id` on the new lead + deal) AND a manual "Assign" control on lead/deal detail.
- **Users/Roles admin UI** under Settings — role matrix editor, assignment-pool toggle, and a users screen to assign roles.
- **Bootstrap admin** — a seeded full-permission `Admin` role and assignment of `ghosaldhiraj@gmail.com` to it, so the first admin is never locked out.

**Out of scope (later / not this spec)**
- Field-level permissions; per-record ACLs / sharing rules beyond `own` vs `all`.
- Multiple roles per user; role hierarchies / inheritance.
- Team/territory structures; approval chains.
- Editing permissions in edge middleware (see §7 — the gate lives in section layouts, not the edge).
- Custom fields (Spec 4), form embed (Spec 5), AiSensy chat (Spec 6).
- Live cron/Railway wiring already owned by Spec 2.

---

## 3. Locked decisions

1. **Custom per-module permissions**, not fixed roles. A `roles.permissions` JSONB describes each module's `view`/`edit` (+ `scope` for leads/deals). See §5 for the exact shape.
2. **Record assignment column reuses the existing `owner_id`.** Both `leads` and `deals` already carry a nullable `owner_id uuid` (added by migration 0003, already surfaced as `owner_email` in `getLeadDetail`). The locked brief named the column `assigned_to`; adopting a second parallel column would fork the "who owns this record" concept. We therefore **use `owner_id` as the assignment/assigned-to column** and add nothing to `leads`/`deals`. This is the one deliberate deviation from the brief, taken for internal consistency; every reference below to "assignment" means `owner_id`.
3. **Assignment pool is a role flag** (`roles.in_assignment_pool boolean`), not a per-user flag — the simplest model: the pool is "every user whose role has `in_assignment_pool = true`". Documented as the chosen option.
4. **Round-robin uses a persistent cursor** in a tiny singleton `assignment_state` table (`last_user_id`), so distribution is deterministic and even across restarts. A submission's lead + deal go to the **same** agent (one assignment per submission).
5. **App-level enforcement**, three layers: (a) section layout gate by `view`, (b) per-action `edit` re-check, (c) scope-filtered queries. RLS stays deny-all as a backstop.
6. **One role per user.** A user with no `profiles` row (or a role with no permissions) is denied everything (fail-closed) — the bootstrap seed guarantees the admin always has a full-permission row.
7. **The gate is not in edge middleware.** Edge middleware cannot read the role (anon client under RLS-deny-all returns nothing; the service-role key must not run at the edge). Middleware keeps the **authentication** boundary unchanged; **authorization** is enforced in Node-runtime section layouts + server actions + queries, matching the codebase's existing "per-action check is the effective authorization boundary" posture.

---

## 4. Data model

New migration: `supabase/migrations/0005_rbac.sql`. All new tables RLS deny-all (service-role only). No columns are added to `leads`/`deals` (assignment reuses the existing `owner_id`).

### 4.1 `roles`
```sql
create table roles (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null unique,
  permissions        jsonb not null default '{}',  -- Permissions shape (§5)
  in_assignment_pool boolean not null default false,
  is_system          boolean not null default false, -- Admin role: non-deletable
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
```
`permissions` holds the full matrix (§5). `is_system` marks the seeded `Admin` role so the UI/actions refuse to delete or de-permission it. `in_assignment_pool` marks a role whose users receive round-robin assignments.

### 4.2 `profiles`
```sql
create table profiles (
  user_id    uuid primary key,             -- references auth.users(id)
  role_id    uuid references roles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_role on profiles (role_id);
```
Maps a Supabase Auth user to exactly one role. `role_id` is nullable so a freshly-created auth user with no assignment is fail-closed (denied everything) until an admin assigns a role. No FK to `auth.users` in the migration body is required — the id is authoritative from Supabase Auth; we keep it a plain `uuid` (a real FK `references auth.users(id)` may be added when the project is linked, but is not needed for correctness because writes go through the service client). The `profiles_role` index backs the "role in use?" delete-guard and the assignment-pool query.

### 4.3 `assignment_state`
```sql
create table assignment_state (
  key          text primary key,           -- singleton key 'round_robin'
  last_user_id uuid,
  updated_at   timestamptz not null default now()
);
```
Holds the round-robin cursor: the user id assigned most recently. A keyed singleton (rather than a `boolean` primary key) keeps room for future per-module cursors without a schema change.

### 4.4 Assignment column (existing `owner_id`)
No DDL. `leads.owner_id uuid` and `deals.owner_id uuid` already exist (migration 0003) and are already read as the record owner (`getLeadDetail.owner_email`). This spec starts **writing** them (round-robin on ingest; manual reassign) and **filtering** by them (scope `own`).

### 4.5 Seeds (guarded; migration is applied out-of-band)
- `Admin` role: full permissions (every module `view+edit`; leads/deals `scope:'all'`), `in_assignment_pool=false`, `is_system=true`. Guarded by `on conflict (name) do nothing`.
- `Agent` role (starter, for the round-robin demo): `view` on `leads/deals/contacts` with leads/deals `scope:'own'`, no `products/forms/settings/automation`, `edit` on `leads/deals`, `in_assignment_pool=true`. Guarded.
- `assignment_state` singleton row `('round_robin', null)`. Guarded by `on conflict (key) do nothing`.
- Bootstrap admin profile — assign `ghosaldhiraj@gmail.com` to `Admin` (see §11).

---

## 5. Permissions JSONB shape

Hand-authored types added to `src/lib/supabase/types.ts` (matching the file's existing style):

```ts
/** Every gated admin module. */
export type ModuleKey =
  | 'products'
  | 'forms'
  | 'leads'
  | 'deals'
  | 'contacts'
  | 'settings'
  | 'automation'

/** A single capability within a module. */
export type Capability = 'view' | 'edit'

/** Record visibility scope for the record modules (leads, deals). */
export type RecordScope = 'all' | 'own'

/** view/edit for a plain module. */
export interface ModulePermission {
  view: boolean
  edit: boolean
}

/** view/edit + scope for the record modules. */
export interface ScopedModulePermission extends ModulePermission {
  scope: RecordScope
}

/** The full per-module matrix stored in roles.permissions. */
export interface Permissions {
  products: ModulePermission
  forms: ModulePermission
  leads: ScopedModulePermission
  deals: ScopedModulePermission
  contacts: ModulePermission
  settings: ModulePermission
  automation: ModulePermission
}

export interface Role {
  id: string
  name: string
  permissions: Permissions
  in_assignment_pool: boolean
  is_system: boolean
  created_at: string
  updated_at: string
}

export interface Profile {
  user_id: string
  role_id: string | null
  created_at: string
  updated_at: string
}

export interface AssignmentState {
  key: string
  last_user_id: string | null
  updated_at: string
}
```

A **deny-all default** (`DEFAULT_DENY_ALL`) fills in any missing/malformed module so a partial or corrupt JSONB never accidentally grants access — the resolver normalizes every parsed `permissions` blob against it.

---

## 6. Permission-check helpers

Two modules, split so the pure logic is unit-testable without `server-only`:

### 6.1 `src/features/rbac/can.ts` (pure, no server-only)
```ts
import type {
  Capability,
  ModuleKey,
  Permissions,
  RecordScope,
} from '@/lib/supabase/types'

/** Nav/gating order; also the order firstAllowedModule scans. */
export const MODULE_ORDER: ModuleKey[]

/** A fully-denied matrix; the safe default for missing/corrupt permissions. */
export const DEFAULT_DENY_ALL: Permissions

/** Deep-merge a partial/unknown blob onto DEFAULT_DENY_ALL (never widens). */
export function normalizePermissions(raw: unknown): Permissions

/** True when the role grants `capability` on `module`. */
export function can(
  perms: Permissions,
  module: ModuleKey,
  capability: Capability
): boolean

/** The record scope for a record module. */
export function scopeFor(perms: Permissions, module: 'leads' | 'deals'): RecordScope

/**
 * The owner id a list/detail query must filter on, or null for no filter.
 * Returns the user's id when the module scope is 'own', else null (scope 'all').
 */
export function ownerScopeFilter(
  perms: Permissions,
  module: 'leads' | 'deals',
  userId: string
): string | null

/** First module (in MODULE_ORDER) the role can view, or null. */
export function firstAllowedModule(perms: Permissions): ModuleKey | null

/** Route path for a module (settings→/admin/settings, automation→/admin/settings/automation). */
export function modulePath(module: ModuleKey): string
```

### 6.2 `src/features/rbac/permissions.ts` (server-only resolver + action guard)
```ts
import 'server-only'
import type { User } from '@supabase/supabase-js'
import type { Capability, ModuleKey, Permissions, Role } from '@/lib/supabase/types'

/** The authenticated user plus the resolved role + normalized permissions. */
export interface CurrentUserWithRole {
  user: User
  role: Role | null
  permissions: Permissions
}

/**
 * Resolve the current session, its profile → role, and normalized permissions.
 * Returns null when unauthenticated. A signed-in user with no profile/role
 * resolves to { user, role: null, permissions: DEFAULT_DENY_ALL } (fail-closed).
 */
export async function getCurrentUserWithRole(): Promise<CurrentUserWithRole | null>

/** ActionResult-shaped guard: assert session + `capability` on `module`. */
export async function requirePermission(
  module: ModuleKey,
  capability: Capability
):
  | Promise<{ ok: true; ctx: CurrentUserWithRole }>
  | Promise<{ ok: false; error: string }>
```

### 6.3 `src/features/rbac/guard.ts` (server-only section gate)
```ts
import 'server-only'
import type { ModuleKey } from '@/lib/supabase/types'
import type { CurrentUserWithRole } from './permissions'

/**
 * Gate an admin section by `view`. Redirects unauthenticated users to login,
 * and users lacking `view` to their first allowed module (or /admin/no-access).
 * Returns the resolved ctx (carries scope) for the page to use.
 */
export async function requireModuleView(
  module: ModuleKey
): Promise<CurrentUserWithRole>
```

`requirePermission` returns the same `ActionResult`-style discriminated shape the codebase uses, so mutating actions read:
```ts
const gate = await requirePermission('deals', 'edit')
if (!gate.ok) return { ok: false, error: gate.error }
const { ctx } = gate
```

---

## 7. Middleware & section gating

**Middleware (`src/middleware.ts`) is unchanged** — it remains the authentication boundary (`/admin/*`, `/api/admin/*` require a session). It does **not** gain permission logic, because edge middleware cannot read a role: the anon client returns nothing under RLS-deny-all, and the service-role key must not run at the edge (§3.7).

**Authorization gate = Node-runtime section layouts.** Each hard-gated module gets a thin `layout.tsx` that calls `requireModuleView(module)`:
- `src/app/admin/products/layout.tsx` → `requireModuleView('products')`
- `src/app/admin/forms/layout.tsx` → `requireModuleView('forms')`
- `src/app/admin/settings/layout.tsx` → `requireModuleView('settings')` (wraps Stages, Roles, Users)
- `src/app/admin/settings/automation/layout.tsx` → `requireModuleView('automation')`

`requireModuleView` redirects a user without `view` to `firstAllowedModule` (or `/admin/no-access` when the role grants nothing). `leads`, `deals`, `contacts` are also gated by their `view` (the typical Agent role has view on all three); the distinguishing behavior for leads/deals is **scope filtering**, applied in the queries (§8), not a different gate.

**Nav reflects permissions.** `AdminLayout` resolves `getCurrentUserWithRole()` once and passes the permission-derived allowed set to `AdminNav`; `SettingsNav` is similarly filtered. Users never see a link they cannot open. `DEFAULT_AUTHED_PATH` in middleware stays `/admin/products`; a user without `products.view` who lands there is bounced by the products layout gate to their first allowed module.

New page: `src/app/admin/no-access/page.tsx` — a plain "You don't have access to any modules — contact your administrator" screen for users with an empty (or unassigned) role.

---

## 8. Query & action enforcement

### 8.1 Scope-filtered reads (leads & deals)
`searchLeads`, `listDeals`, `getLeadDetail`, `getDealTimeline` gain an optional `ctx: CurrentUserWithRole` parameter. When present and the module scope is `own`, the query adds `.eq('owner_id', ctx.user.id)`; detail loaders return `null` when the record's `owner_id` doesn't match (an own-scope user cannot deep-link into another agent's record). Scope `all` is unfiltered (current behavior). The server components that render these screens pass the ctx they already resolved from the layout gate.

Helper used inside the query:
```ts
const ownerId = ownerScopeFilter(ctx.permissions, 'leads', ctx.user.id)
if (ownerId) query = query.eq('owner_id', ownerId)
```
Contacts have **no** scope in the model (a plain `view/edit` module), so `listContacts` is gated only by `contacts.view` (the section gate), not filtered.

### 8.2 Action enforcement
Every mutating server action first calls `requirePermission(module, 'edit')` (replacing the bare `getCurrentUser()` assertion) — e.g. stage/deal actions check `deals.edit`, product actions check `products.edit`, form/automation/role actions check their module. For **own-scope** edits, the action additionally re-reads the target's `owner_id` and refuses when it isn't the current user's — an agent may only mutate/reassign records they own. The `ActionResult<T>` shape (`{ok:true,data}|{ok:false,error,fieldErrors?}`) is unchanged.

Existing Spec 1/2 actions (`createStage`, `changeDealStage`, deal/product/form/automation actions) are migrated from `getCurrentUser()` to `requirePermission(...)`. Because `requirePermission` internally calls `getCurrentUser()`, the authentication guarantee is preserved and authorization is added on top.

---

## 9. Assignment

### 9.1 Auto round-robin on ingest
`src/features/rbac/assignment.ts`:
```ts
/** Pure, testable: next user after the cursor, wrapping; null if pool empty. */
export function pickRoundRobin(
  poolUserIds: string[],
  lastAssignedUserId: string | null
): string | null

/**
 * Resolve the assignment pool (users whose role.in_assignment_pool = true),
 * read the 'round_robin' cursor, pick the next user, persist the cursor, and
 * return the chosen user id (or null when the pool is empty). server-only.
 */
export async function assignNext(): Promise<string | null>
```
Pool query: `profiles` joined to `roles` where `roles.in_assignment_pool = true`, ordered by `user_id` (stable). `pickRoundRobin` finds the cursor's index and returns the next id modulo pool length; if the cursor is null or absent from the (possibly changed) pool, it returns the first id.

Wired into `src/app/api/ingest/route.ts`: after the lead insert (6a) and deal insert (6e), call `assignNext()` once and stamp the returned id onto **both** `leads.owner_id` and `deals.owner_id` (same agent for a submission). `assignNext()` is best-effort — a null (empty pool) leaves `owner_id` null (record is unassigned, visible only to `all`-scope roles), and any failure is swallowed so ingest never fails on assignment. The resume/idempotency paths do not re-assign an existing deal.

### 9.2 Manual reassign
`src/features/rbac/actions.ts`:
```ts
export async function assignLead(
  leadId: string,
  assigneeUserId: string | null
): Promise<ActionResult<void>>   // requires leads.edit; own-scope ⇒ must currently own it

export async function assignDeal(
  dealId: string,
  assigneeUserId: string | null
): Promise<ActionResult<void>>   // requires deals.edit; own-scope ⇒ must currently own it
```
An "Assign" control on the lead detail (`src/app/admin/leads/[id]`) and deal detail (`src/app/admin/deals/[id]`) pages renders a dropdown of assignable users (from `listAssignableUsers()`, §10) and calls these actions. Setting `null` unassigns. Reassignment logs an `edited` activity via the existing `logActivity`.

`listAssignableUsers()` (server-only query) enumerates Supabase Auth users via `supabase.auth.admin.listUsers()`, joins their `profiles.role_id` → role name, and returns `{ id, email, roleName }[]` for the dropdowns and the Users screen.

---

## 10. Users / Roles admin UI (under Settings)

Two new Settings screens, gated by `settings.view` (the settings section layout).

### 10.1 Roles — `/admin/settings/roles`
`RolesEditor.tsx` (client), driven by role CRUD actions:
- List roles (name, module summary chips, "In pool" chip, "System" chip for Admin).
- Create role (name).
- **Permission matrix editor**: a table of modules × (View, Edit) checkboxes; leads & deals additionally show a scope `all | own` select. Matches the Stages editor's row-border table + `--accent` primary button.
- `in_assignment_pool` toggle per role.
- Delete role — refused when `is_system` or when any `profiles` row references it (mirrors the Stages "in use" delete-guard).

Role actions in `src/features/rbac/actions.ts`:
```ts
createRole(input): Promise<ActionResult<Role>>              // settings.edit
updateRolePermissions(id, permissions): Promise<ActionResult<Role>> // settings.edit; refuse de-permissioning is_system
setRoleAssignmentPool(id, inPool): Promise<ActionResult<void>>      // settings.edit
deleteRole(id): Promise<ActionResult<void>>                // settings.edit; guard system + in-use
```
Validated with a Zod `roleSchema` / `permissionsSchema` in `src/features/rbac/schema.ts`.

### 10.2 Users — `/admin/settings/users`
`UsersEditor.tsx` (client):
- List auth users (email) with their current role (from `listAssignableUsers()`).
- Assign / change role via a dropdown of roles.

Action:
```ts
assignUserRole(userId: string, roleId: string | null): Promise<ActionResult<void>> // settings.edit
```
Upserts the `profiles` row. Guard: an admin cannot strip the **last** `is_system` Admin from the only Admin user (prevents self-lockout) — refuse removing the Admin role from the last remaining Admin-role user.

### 10.3 Nav
`SettingsNav` gains `Roles` and `Users` entries (filtered by `settings.view`); the automation entry is filtered by `automation.view`. `AdminNav` shows the Settings link when `settings.view || automation.view`.

---

## 11. Bootstrap admin

The migration seeds a full-permission `Admin` role and best-effort assigns the existing admin:
```sql
insert into profiles (user_id, role_id)
select u.id, r.id
from auth.users u
cross join roles r
where u.email = 'ghosaldhiraj@gmail.com' and r.name = 'Admin'
on conflict (user_id) do nothing;
```
This is guarded (`on conflict do nothing`) and idempotent. If the auth user does not yet exist when the migration runs, it assigns **zero** rows — so the spec documents a **manual fallback** an operator runs once the admin user exists:
```sql
-- Run once, after the admin has signed up in Supabase Auth:
insert into profiles (user_id, role_id)
select u.id, r.id from auth.users u, roles r
where u.email = 'ghosaldhiraj@gmail.com' and r.name = 'Admin'
on conflict (user_id) do update set role_id = excluded.role_id;
```
Because `getCurrentUserWithRole` is fail-closed, the bootstrap seed (or this snippet) is **required** before the admin can see anything — this is called out in the plan's Task ordering and the ENV-PENDING list. There is intentionally no fail-open path.

---

## 12. Testing

- **Unit (pure, Vitest, no DB):**
  - `src/features/rbac/can.test.ts` — `can`, `scopeFor`, `ownerScopeFilter`, `firstAllowedModule`, `modulePath`, and `normalizePermissions` (partial/corrupt blob → deny-all defaults; never widens).
  - `src/features/rbac/assignment.test.ts` — `pickRoundRobin`: empty pool → null; cursor null → first; middle cursor → next; last cursor → wraps to first; cursor no longer in pool → first.
- **Integration (ENV-PENDING, needs live Supabase + ≥2 auth users):** resolver `getCurrentUserWithRole`, scope-filtered queries, action guards, ingest round-robin distribution, section-layout redirects.

---

## 13. ENV-PENDING

- **Bootstrap assignment** needs the live `auth.users` row for `ghosaldhiraj@gmail.com`; run §11's snippet after first sign-up.
- **Round-robin distribution** needs ≥2 users in the assignment pool to observe alternation.
- **Section gating / scope filtering** end-to-end needs seeded roles + a second (Agent) test user.
- **`profiles → auth.users` FK** can be added when the Supabase project is linked; not required for correctness (writes go through the service client).

---

## 14. Files

- `supabase/migrations/0005_rbac.sql` — roles, profiles, assignment_state (+ seeds).
- `src/lib/supabase/types.ts` — ModuleKey, Capability, RecordScope, ModulePermission, ScopedModulePermission, Permissions, Role, Profile, AssignmentState.
- `src/features/rbac/can.ts` (+ `.test.ts`) — pure permission logic.
- `src/features/rbac/permissions.ts` — resolver + `requirePermission`.
- `src/features/rbac/guard.ts` — `requireModuleView`.
- `src/features/rbac/assignment.ts` (+ `.test.ts`) — round-robin.
- `src/features/rbac/actions.ts` (+ `schema.ts`) — assign + role/user CRUD actions.
- `src/features/rbac/queries.ts` — `listRoles`, `listAssignableUsers`.
- `src/app/admin/settings/{roles,users}/{page.tsx, RolesEditor.tsx | UsersEditor.tsx}`; Settings sub-nav.
- `src/app/admin/{products,forms,settings}/layout.tsx`, `src/app/admin/settings/automation/layout.tsx` — section gates.
- `src/app/admin/no-access/page.tsx`.
- Modify: `src/app/admin/layout.tsx` + `AdminNav.tsx` + `SettingsNav.tsx` (permission-filtered nav); `src/app/api/ingest/route.ts` (round-robin); `src/features/records/queries.ts` (scope filter); existing Spec 1/2 actions (`requirePermission`); lead/deal detail pages (Assign control).
