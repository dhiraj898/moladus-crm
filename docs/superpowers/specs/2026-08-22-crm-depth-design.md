# Spec 1 — CRM Depth — Design

**Date:** 2026-08-22
**Status:** Draft (awaiting review)
**Phase:** 1 of 6 in the v1.5/v2 roadmap (see §9). Builds on merged v1 (`main`).

---

## 1. Goal

Make the CRM records actually usable day-to-day: full detail pages, a configurable deal-stage pipeline with manual status changes (including "Call Requested"), an activity timeline with notes, and the ability to create and edit Leads, Contacts, and Deals by hand — not only via the public form.

This spec deliberately does **not** include workflow automation (that fires *on* stage change — Spec 2), RBAC enforcement (Spec 3), custom fields (Spec 4), form embed (Spec 5), or AiSensy chat (Spec 6). It lays the ownership/actor foundations those later specs need.

---

## 2. Scope

**In scope**
- Configurable **stages** (definitions + Settings CRUD; manual movement only)
- **Manual stage change** on a Deal, writing stage history (`entered_at`, actor)
- **Lead detail** and **Contact detail** pages (Deal detail already exists — enhanced)
- **Activity timeline** per Lead and Deal: free-text notes (with author) + auto-logged system events
- **Manual create + edit** of Lead, Contact, Deal (Product edit already exists in v1)
- **Ownership** (`owner_id`) on Leads and Deals — displayed, not yet enforced
- A **Settings** section shell (`/admin/settings`) hosting the Stages editor

**Out of scope (later specs):** automation/on-enter actions/time reminders (Spec 2), RBAC enforcement (Spec 3), custom fields (Spec 4), form embed + hide-price (Spec 5), AiSensy conversation (Spec 6), typed activities, personal tasks, GST invoice PDF, refunds.

---

## 3. Locked decisions (from brainstorming 2026-08-22)

1. Manual sales status lives **on the Deal**; `payment_status` stays separate and auto-managed by Razorpay.
2. Stages are **admin-configurable in Settings** (not hardcoded). Seed a default set; user refines.
3. Default seeded pipeline (user will refine in Settings): **New → Call Requested → Payment Link Sent → Enrolled (won) → Closed Lost (lost)**.
4. **Notes** are simple timestamped free-text with an author. Typed activities + personal tasks deferred.
5. **Manual creation** allowed for **Lead, Contact, and Deal**. Deal creation runs the GST calc; payment-link creation is optional at create time.
6. Built **RBAC-aware**: `owner_id` + actor stamping added now; enforcement is Spec 3.

---

## 4. Data model changes

New migration: `supabase/migrations/0003_crm_depth.sql`.

### 4.1 `stages` (new)
```sql
create table stages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_order integer not null,
  type text not null check (type in ('open','won','lost')) default 'open',
  is_default boolean not null default false,   -- initial stage for new deals
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table stages enable row level security;  -- deny-all; service-role only
create unique index stages_one_default on stages (is_default) where is_default;
```
Seed rows (idempotent): New (open, is_default), Call Requested (open), Payment Link Sent (open), Enrolled (won), Closed Lost (lost) — display_order 1..5.

### 4.2 `deals` — replace free-text stage with FK + ownership
```sql
alter table deals add column stage_id uuid references stages(id);
alter table deals add column owner_id uuid;          -- references auth.users; displayed, not enforced yet
alter table deals add column stage_entered_at timestamptz;  -- when current stage was entered (Spec 2 uses this)
-- backfill: point every existing deal at the default stage
update deals set stage_id = (select id from stages where is_default), stage_entered_at = now() where stage_id is null;
alter table deals drop column stage;                 -- remove the dead free-text column
```
`payment_status` is unchanged (auto). Note the current `src/app/admin/deals/[id]/page.tsx:164` and `types.ts:178` reference the old `stage`; both are updated to `stage_id`/joined stage name.

### 4.3 `leads` — ownership
```sql
alter table leads add column owner_id uuid;   -- displayed, not enforced yet
```

### 4.4 `deal_stage_events` (new) — stage history
```sql
create table deal_stage_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  stage_id uuid not null references stages(id),
  actor_id uuid,                 -- auth.users id, or null for system
  entered_at timestamptz not null default now()
);
alter table deal_stage_events enable row level security;
create index deal_stage_events_deal on deal_stage_events (deal_id, entered_at desc);
```
Backfill one row per existing deal (default stage, `entered_at = now()`, actor null).

### 4.5 `activities` (new) — the timeline source of truth
```sql
create table activities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('lead','deal','contact')),
  entity_id uuid not null,
  type text not null check (type in ('note','stage_change','created','edited','payment','notification')),
  actor_id uuid,                 -- auth.users id, null for system events
  body text,                     -- note text, or human summary of a system event
  metadata jsonb not null default '{}',   -- e.g. {from_stage, to_stage} for stage_change
  created_at timestamptz not null default now()
);
alter table activities enable row level security;
create index activities_entity on activities (entity_type, entity_id, created_at desc);
```
- User **notes** → `type='note'`, `body` = text, `actor_id` = current user.
- **Manual stage change** writes both a `deal_stage_events` row and an `activities` row (`type='stage_change'`, metadata `{from,to}`, actor).
- **create/edit** of a record writes `type='created'`/`'edited'`.
- The existing Razorpay webhook and AiSensy send are extended to write `type='payment'` / `type='notification'` activity rows (small additions; the source of record stays `deals`/`notification_log`).

### 4.6 Types
`src/lib/supabase/types.ts` gains `Stage`, `DealStageEvent`, `Activity`, enums `StageType`, `ActivityType`; `Deal` loses `stage`, gains `stage_id`, `owner_id`, `stage_entered_at`; `Lead` gains `owner_id`.

---

## 5. Server actions & queries

New feature dir `src/features/crm/`:

- `stages/actions.ts` — `listStages()`, `createStage`, `updateStage`, `reorderStages`, `setDefaultStage`, `deleteStage` (block delete if any deal references it; block deleting the default). Zod-validated. Each asserts `getCurrentUser()`.
- `deals/actions.ts` — `changeDealStage(dealId, stageId)` (writes `deal_stage_events` + `activities`, sets `deals.stage_id` + `stage_entered_at`, actor = current user); `createDeal(input)` (resolve/attach lead+contact, `computeGST` from product + place_of_supply, insert deal at default stage, optional `createPaymentLink`); `updateDeal(input)`.
- `leads/actions.ts` — `createLead`, `updateLead`.
- `contacts/actions.ts` — `createContact`, `updateContact`.
- `activities/actions.ts` — `addNote(entityType, entityId, body)`; `getActivityTimeline(entityType, entityId)` returns activities merged, newest first, with actor email resolved.

`getCurrentUser()` (existing `src/lib/supabase/auth.ts`) is the actor + auth boundary for every mutation, matching the v1 pattern.

Reuse: `computeGST` (`src/features/gst`), `createPaymentLink` (`src/features/razorpay`), existing `getDealTimeline`/records queries (extended to join `stages` for the stage name + include `stage_id`).

---

## 6. Screens

- **Settings shell** `/admin/settings` — section nav; first entry **Stages**.
- **Stages editor** `/admin/settings/stages` — list with add/rename, reorder (up/down), type select (open/won/lost), set-default, delete (guarded). Design-system table.
- **Lead detail** `/admin/leads/[id]` — all lead fields + raw payload + UTM; linked Contact and Deals; owner; **activity timeline** + note composer; Edit button. (New — leads currently list-only.)
- **Contact detail** `/admin/contacts/[id]` — contact fields + consent; linked Lead and Deals; activity timeline + notes; Edit. (New.)
- **Deal detail** `/admin/deals/[id]` — enhanced: **stage dropdown** (change → confirm → fires `changeDealStage`), **stage history** list, activity timeline + notes, owner; existing GST/payment cards retained.
- **Manual create** — `/admin/leads/new`, `/admin/contacts/new`, `/admin/deals/new` (deal: product picker + contact/lead attach + customer state → live GST preview → create, with "create payment link now" checkbox).
- **Edit** — `/admin/leads/[id]/edit`, `/admin/contacts/[id]/edit`, `/admin/deals/[id]/edit`.
- Lists (`leads`, `deals`, `contacts`) gain a row link to the new detail pages; deals list shows the stage name.

All follow the Moladus design system (Inter, dark-default tokens, row-border tables, tabular numerals on money).

---

## 7. Behaviour & edge cases

- **Stage change** is transactional: update `deals.stage_id` + `stage_entered_at`, insert `deal_stage_events`, insert `activities` — if any fails, none commit (Supabase RPC or sequential with guard; sequential acceptable since additive).
- **No automation** on stage change in this spec — changing to "Payment Link Sent" does *not* auto-send WhatsApp yet (that's Spec 2). Manual for now.
- **Manual deal creation** without live Razorpay keys: "create payment link now" left unchecked creates the deal with no link (payment_status `pending`); checked-but-Razorpay-fails surfaces an inline error and still saves the deal (link can be added later).
- **Deleting a stage** referenced by deals is blocked with a clear message; the default stage cannot be deleted or unset without choosing a new default.
- **Ownership** shown as a plain field now; assignment UI + enforcement is Spec 3.
- **Actor resolution**: `activities.actor_id` / `deal_stage_events.actor_id` store the auth user id; timeline resolves to email for display (admin users are few).

---

## 8. Testing

- Unit: `changeDealStage` writes exactly one `deal_stage_events` + one `activities` row and updates `stage_id`/`stage_entered_at` (with a mocked service client).
- Unit: manual `createDeal` computes GST via `computeGST` and persists the breakdown (reuse tested GST module; assert the wiring).
- Unit: `reorderStages` / `setDefaultStage` maintain the single-default invariant.
- Unit: `getActivityTimeline` returns merged rows newest-first.
- Gates per task: `npm run lint && npm run type-check && npm run build` (+ `npm run test`).

---

## 9. Roadmap context (for reference; not built here)

1. **CRM Depth** ← this spec
2. Workflow Automation (entry routing, on-enter actions, time reminders + Railway scanner, ingest reshape)
3. RBAC (roles, module access, own-vs-all enforcement, assignment)
4. Custom Fields (Settings-defined, rendered into the detail pages built here)
5. Form embed + hide-price toggle
6. AiSensy chat (webhook capture → thread view; Pro plan available)
