# Workflow Automation (Spec 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configurable, no-code deal-stage automation — entry routing by form answers, on-enter actions (send WhatsApp / create payment link), and time-based SLA rules (reminders → auto-move) — driven by data in a few tables and interpreted by a small deterministic engine.

**Architecture:** Builds on Spec 1 (stages, deal_stage_events, activities, deals.stage_id/stage_entered_at, changeDealStage). Four new tables (entry_rules, stage_actions, sla_rules, automation_runs) hold config; an engine under `src/features/crm/automation/` evaluates conditions, resolves entry stage, runs on-enter actions imperatively at each transition, and scans due SLA rules. The ingest route is reshaped so payment-link creation becomes an on-enter action of the Payment stage. A secret-protected `/api/cron/scan` route fires SLA rules.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase JS, Zod, Vitest, Tailwind (design tokens).

## Global Constraints

- Node 20+; Next.js 15 App Router; TypeScript strict.
- Supabase accessed ONLY server-side via `getServiceClient()` (`src/lib/supabase/server.ts`). RLS deny-all on every new table.
- Every mutating server action + the cron route assert authorization: config actions call `getCurrentUser()` (`src/lib/supabase/auth.ts`); the cron route requires `Authorization: Bearer ${CRON_SECRET}`.
- Secrets server-side only; add `CRON_SECRET` to `src/lib/env.ts` schema + `.env.example`.
- On-enter actions run imperatively at the transition point (entry routing, manual `changeDealStage`, SLA move) — exactly once per transition. Only SLA rules use the scanner; dedup via the `automation_runs` unique index.
- `move_stage` is NOT a valid on-enter (`stage_actions`) action — only `sla_rules` may move stages (loop guard).
- SLA firing is at-most-once per (deal, rule, stage_entered_at); failures logged to `activities`, never auto-retried.
- Reuse existing wrappers: `createPaymentLink` (`src/features/razorpay/paymentLink.ts`), AiSensy `sendTemplate`/`sendEnrollmentLink` (`src/features/aisensy/send.ts`), `changeDealStage` + `logActivity` (`src/features/crm/`), `computeGST` where needed.
- Design system: Inter, dark-default tokens, `--accent:#ff4500`, colors via CSS vars, row-border tables — match the existing Stages editor.
- Gates per task: `cd '/Users/dhirajghosal/Documents/Molades CRM' && npm run lint && npm run type-check && npm run build` (+ `npm run test` where tests exist).
- Migrations are SQL files applied out-of-band; do NOT run them in a gate; the build must stay green without them (types hand-authored).
- Never run `npm run dev` or any long-running server in a gate.

---

## File Structure

- `supabase/migrations/0004_workflow_automation.sql` — entry_rules, stage_actions, sla_rules, automation_runs + seed.
- `src/lib/supabase/types.ts` — add EntryRule, StageAction, SlaRule, AutomationRun, Condition/ConditionOp.
- `src/lib/env.ts`, `.env.example` — add CRON_SECRET.
- `src/features/crm/automation/conditions.ts` (+ `.test.ts`) — condition evaluator.
- `src/features/crm/automation/entry.ts` (+ `.test.ts`) — entry-stage resolver.
- `src/features/crm/automation/runActions.ts` — on-enter action runner.
- `src/features/crm/automation/sla.ts` (+ `.test.ts`) — SLA scanner.
- `src/features/crm/automation/actions.ts` (+ `schema.ts`) — config CRUD server actions.
- `src/features/crm/automation/queries.ts` — config reads (server-only).
- `src/app/api/cron/scan/route.ts` (+ `.test.ts`) — scanner endpoint.
- `src/app/admin/settings/automation/{page.tsx, EntryRulesEditor.tsx, StageActionsEditor.tsx, SlaRulesEditor.tsx}` + Settings sub-nav link.
- Modify: `src/app/api/ingest/route.ts` (reshape), `src/features/crm/deals/actions.ts` (`changeDealStage` calls `runStageActions`).

---

## Workstream 1: db (migration + types)

### Task 1.1: Migration 0004_workflow_automation.sql

**Files:**
- Create: `supabase/migrations/0004_workflow_automation.sql`

**Interfaces:**
- Produces (DB): entry_rules, stage_actions, sla_rules, automation_runs (all RLS deny-all) + the automation_runs unique index; seeds a default entry rule → "Payment Link Sent" and that stage's on-enter actions (create_payment_link, send_whatsapp enrollment_link).

- [ ] **Step 1: Write the migration** (verbatim):

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0004_workflow_automation.sql
git commit -m "feat(db): workflow automation migration — entry rules, stage actions, sla rules"
```

### Task 1.2: Types + CRON_SECRET env

**Files:**
- Modify: `src/lib/supabase/types.ts`, `src/lib/env.ts`, `.env.example`

**Interfaces:**
- Produces: `ConditionOp = 'eq'|'neq'|'in'|'not_in'|'is_empty'|'not_empty'`; `Condition = { field: string; op: ConditionOp; value?: unknown }`; interfaces `EntryRule`, `StageAction`, `SlaRule`, `AutomationRun`; `getEnv().CRON_SECRET`.

- [ ] **Step 1: types.ts** — add:

```typescript
export type ConditionOp = 'eq' | 'neq' | 'in' | 'not_in' | 'is_empty' | 'not_empty'
export interface Condition { field: string; op: ConditionOp; value?: unknown }
export type StageActionType = 'send_whatsapp' | 'create_payment_link'
export type SlaActionType = 'send_whatsapp' | 'move_stage'

export interface EntryRule {
  id: string; condition: Condition | null; to_stage_id: string
  priority: number; active: boolean; created_at: string; updated_at: string
}
export interface StageAction {
  id: string; stage_id: string; action_type: StageActionType
  config: Record<string, unknown>; run_order: number; active: boolean; created_at: string
}
export interface SlaRule {
  id: string; from_stage_id: string; delay_minutes: number; condition: Condition | null
  action_type: SlaActionType; config: Record<string, unknown>; active: boolean; created_at: string
}
export interface AutomationRun {
  id: string; deal_id: string; sla_rule_id: string; stage_entered_at: string; fired_at: string
}
```

- [ ] **Step 2: env.ts** — add `CRON_SECRET: z.string().min(1)` to the schema.
- [ ] **Step 3: .env.example** — add `CRON_SECRET=`.
- [ ] **Step 4: Gates** — lint + type-check + build
- [ ] **Step 5: Commit** — `git commit -am "feat: automation types + CRON_SECRET env"`

---

## Workstream 2: engine-core (conditions + entry resolver)

### Task 2.1: Condition evaluator

**Files:**
- Create: `src/features/crm/automation/conditions.ts`, `src/features/crm/automation/conditions.test.ts`

**Interfaces:**
- Consumes: `Condition`, `ConditionOp`.
- Produces: `evaluateCondition(cond: Condition | null, ctx: Record<string, unknown>): boolean`.

- [ ] **Step 1: Write failing tests** covering: null → true; eq true+false; neq true+false; in (value is array) true+false; not_in true+false; is_empty (missing/''/[]) true, non-empty false; not_empty inverse; unknown field with eq → false, with neq → true.

```typescript
import { describe, it, expect } from 'vitest'
import { evaluateCondition } from './conditions'
describe('evaluateCondition', () => {
  it('null condition matches', () => expect(evaluateCondition(null, {})).toBe(true))
  it('eq', () => { expect(evaluateCondition({field:'a',op:'eq',value:'x'},{a:'x'})).toBe(true)
    expect(evaluateCondition({field:'a',op:'eq',value:'x'},{a:'y'})).toBe(false) })
  it('in', () => expect(evaluateCondition({field:'a',op:'in',value:['x','y']},{a:'y'})).toBe(true))
  it('is_empty', () => { expect(evaluateCondition({field:'a',op:'is_empty'},{a:''})).toBe(true)
    expect(evaluateCondition({field:'a',op:'is_empty'},{a:'x'})).toBe(false) })
  it('missing field: eq false, neq true', () => {
    expect(evaluateCondition({field:'z',op:'eq',value:'x'},{})).toBe(false)
    expect(evaluateCondition({field:'z',op:'neq',value:'x'},{})).toBe(true) })
})
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement conditions.ts** — read `ctx[cond.field]`; empty = `undefined | null | '' | []`; `in`/`not_in` treat `value` as array; string-compare via `String()` for eq/neq to tolerate number/string mismatch.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(automation): condition evaluator + tests"`

### Task 2.2: Entry-stage resolver

**Files:**
- Create: `src/features/crm/automation/entry.ts`, `src/features/crm/automation/entry.test.ts`
- Create: `src/features/crm/automation/queries.ts`

**Interfaces:**
- Consumes: `getServiceClient()`, `evaluateCondition`, `EntryRule`.
- Produces: `resolveEntryStage(answers: Record<string, unknown>): Promise<string>` — returns the first active entry_rule (by ascending priority) whose condition matches, else the default stage id; `listActiveEntryRules()` in queries.ts.

- [ ] **Step 1: Write failing test** (mock getServiceClient to return ordered rules + default stage): highest-priority (lowest number) matching rule wins; when no rule matches, returns the is_default stage id.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — load active entry_rules ordered by priority asc; return first where `evaluateCondition(rule.condition, answers)`; fallback: select `stages.id where is_default`.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Gates** — lint + type-check + build + test
- [ ] **Step 6: Commit** — `git commit -am "feat(automation): entry-stage resolver + tests"`

---

## Workstream 3: actions + ingest reshape

### Task 3.1: On-enter action runner

**Files:**
- Create: `src/features/crm/automation/runActions.ts`

**Interfaces:**
- Consumes: `getServiceClient()`, `createPaymentLink` (`src/features/razorpay/paymentLink.ts`), AiSensy `sendTemplate` (`src/features/aisensy/send.ts`), `logActivity` (`src/features/crm/activities/service.ts`), `StageAction`.
- Produces: `runStageActions(dealId: string, stageId: string): Promise<void>` — loads active `stage_actions` for `stageId` ordered by `run_order` and executes each best-effort; never throws.

- [ ] **Step 1: Implement runActions.ts** — for each action:
  - `create_payment_link`: load the deal (total_amount, contact name/whatsapp/email); call `createPaymentLink`; on success update deal `razorpay_payment_link_id/_url` + `payment_status='link_sent'`; `logActivity('deal', dealId, 'payment', {metadata:{status:'link_sent'}})`; on failure `logActivity(... 'notification'? )` — use a payment activity with a failure note. Skip if a link already exists (idempotent re-enter).
  - `send_whatsapp`: read `config.template`; load contact whatsapp + name + the payment link (if any) + product name; call the AiSensy `sendTemplate(template, whatsapp, params)`; the send helper already logs a `notification` activity + notification_log row.
  - Wrap EACH action in try/catch; a failure logs to `activities` and continues; the function never throws.
- [ ] **Step 2: Gates** — lint + type-check + build
- [ ] **Step 3: Commit** — `git commit -am "feat(automation): on-enter stage action runner"`

### Task 3.2: Wire changeDealStage + reshape ingest

**Files:**
- Modify: `src/features/crm/deals/actions.ts`, `src/app/api/ingest/route.ts`

**Interfaces:**
- Consumes: `runStageActions` (3.1), `resolveEntryStage` (2.2).
- Produces: `changeDealStage` runs on-enter actions after a successful move; ingest routes via `resolveEntryStage` then runs on-enter actions instead of the inline payment-link + WhatsApp calls.

- [ ] **Step 1: changeDealStage** — after updating stage + inserting `deal_stage_events` + logging `stage_change`, call `await runStageActions(dealId, newStageId)`. (Non-fatal; runActions never throws.)
- [ ] **Step 2: Reshape ingest** — in `src/app/api/ingest/route.ts`: after inserting the deal (currently sets `stage_id = default`), replace with `const stageId = await resolveEntryStage(answers)`; set the deal's `stage_id` + `stage_entered_at` to that; insert the opening `deal_stage_events` row with `stage_id`; then `await runStageActions(dealId, stageId)`. REMOVE the inline `createPaymentLink(...)`, the deal update to `link_sent`, and the `sendEnrollmentLink(...)` block (lines around the current 105–140) — those are now handled by the Payment stage's seeded on-enter actions. Keep the idempotency/dedupe (return existing open deal's link) logic unchanged; when returning an existing open deal, still return its `razorpay_payment_link_url`.
- [ ] **Step 3: Ensure the ingest response** still returns `{ success, payment_link }` — after `runStageActions`, re-read the deal's `razorpay_payment_link_url` (it may have been set by the create_payment_link action) and return it (may be null if the entry stage has no link action, e.g. Call Requested — that's correct; the form shows a "we'll be in touch" confirmation instead of redirecting).
- [ ] **Step 4: Gates** — lint + type-check + build + test (existing ingest/GST tests must still pass)
- [ ] **Step 5: Commit** — `git commit -am "feat(automation): run on-enter actions from stage change + ingest"`

---

## Workstream 4: sla + cron

### Task 4.1: SLA scanner

**Files:**
- Create: `src/features/crm/automation/sla.ts`, `src/features/crm/automation/sla.test.ts`

**Interfaces:**
- Consumes: `getServiceClient()`, `evaluateCondition`, `changeDealStage` (for move_stage), AiSensy `sendTemplate`, `logActivity`, `SlaRule`.
- Produces: `scanDueSlaRules(): Promise<{ fired: number }>`.

- [ ] **Step 1: Write failing test** (mock service client): given one active sla_rule (from_stage S, delay 1440, condition payment_status neq paid) and a deal in S with `stage_entered_at` 2 days ago, unpaid, no automation_runs row → the scan fires it once (inserts automation_runs, dispatches the action) and returns `{fired:1}`; a second scan with the automation_runs row present fires 0; a deal whose condition fails (paid) fires 0.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement sla.ts** — for each active sla_rule: select deals where `stage_id = from_stage_id` and `stage_entered_at <= now() - (delay_minutes * interval)` and no `automation_runs` row for `(deal.id, rule.id, deal.stage_entered_at)`; for each, evaluate `condition` against the deal row; if it holds, INSERT the automation_runs guard first (on unique-violation skip — already fired), then dispatch: `send_whatsapp` → `sendTemplate(config.template, ...)`; `move_stage` → `changeDealStage(deal.id, config.to_stage_id)` with a system actor (null). Count successes. Wrap each deal in try/catch; log failures to `activities`; continue.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Gates** — lint + type-check + build + test
- [ ] **Step 6: Commit** — `git commit -am "feat(automation): SLA scanner + tests"`

### Task 4.2: Cron scan route

**Files:**
- Create: `src/app/api/cron/scan/route.ts`, `src/app/api/cron/scan/route.test.ts`

**Interfaces:**
- Consumes: `scanDueSlaRules` (4.1), `getEnv().CRON_SECRET`.
- Produces: `GET`/`POST /api/cron/scan` — 401 unless `Authorization: Bearer ${CRON_SECRET}`; else `{ fired }`.

- [ ] **Step 1: Write failing test** — a request with no/wrong bearer → 401; correct bearer → 200 with `{fired}` (mock `scanDueSlaRules`).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement route** — read the Authorization header; timing-safe-compare to `Bearer ${CRON_SECRET}`; on mismatch 401; else `await scanDueSlaRules()` and return JSON. `export const runtime = 'nodejs'`.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Gates** — lint + type-check + build + test
- [ ] **Step 6: Commit** — `git commit -am "feat(automation): secured cron scan route"`

---

## Workstream 5: automation-ui (Settings → Automation)

### Task 5.1: Config schemas + actions + queries

**Files:**
- Create: `src/features/crm/automation/schema.ts`, `src/features/crm/automation/actions.ts` (append to queries.ts from 2.2)
- Modify: `src/features/crm/automation/queries.ts`

**Interfaces:**
- Consumes: `getServiceClient()`, `getCurrentUser()`.
- Produces: Zod schemas + `ActionResult` CRUD: entry rules (`createEntryRule`, `updateEntryRule`, `reorderEntryRules`, `deleteEntryRule`), stage actions (`createStageAction`, `updateStageAction`, `reorderStageActions`, `deleteStageAction`), sla rules (`createSlaRule`, `updateSlaRule`, `deleteSlaRule`, `toggleSlaRule`); queries `listEntryRules`, `listStageActions(stageId)`, `listSlaRules`.

- [ ] **Step 1: schema.ts** — Zod for a Condition (`{field, op enum, value optional}`), entryRuleSchema (condition nullable, to_stage_id uuid, priority int), stageActionSchema (stage_id, action_type enum WITHOUT move_stage, config, run_order), slaRuleSchema (from_stage_id, delay_minutes>0, condition nullable, action_type enum, config; if action_type='move_stage' require config.to_stage_id, if 'send_whatsapp' require config.template).
- [ ] **Step 2: actions.ts** — `'use server'`; all assert `getCurrentUser()`; validate; insert/update/delete; revalidate `/admin/settings/automation`. `reorder*` set priority/run_order by index.
- [ ] **Step 3: queries.ts** — server-only list functions.
- [ ] **Step 4: Gates** — lint + type-check + build
- [ ] **Step 5: Commit** — `git commit -am "feat(automation): config schemas, actions, queries"`

### Task 5.2: Automation settings UI

**Files:**
- Create: `src/app/admin/settings/automation/page.tsx`, `EntryRulesEditor.tsx`, `StageActionsEditor.tsx`, `SlaRulesEditor.tsx`
- Modify: `src/app/admin/settings/SettingsNav.tsx` (add Automation link)

**Interfaces:**
- Consumes: automation actions + queries (5.1); `listStages` (Spec 1).
- Produces: `/admin/settings/automation` with three editors.

- [ ] **Step 1: page.tsx** — server component: load stages, entry rules, stage actions (grouped by stage), sla rules; render the three editors; force-dynamic.
- [ ] **Step 2: EntryRulesEditor** — client: ordered list (priority) of `condition (field text + op select + value) → to_stage select`; the NULL-condition fallback shown as "Otherwise → {stage}"; add/reorder/delete/active toggle; inline errors.
- [ ] **Step 3: StageActionsEditor** — client: per-stage ordered list of on-enter actions (type select limited to send_whatsapp/create_payment_link; template input for whatsapp); add/reorder/delete/toggle.
- [ ] **Step 4: SlaRulesEditor** — client: list of from-stage + delay (days/hours inputs → minutes) + condition + action (send_whatsapp template / move to stage select); add/delete/toggle.
- [ ] **Step 5: SettingsNav** — add an "Automation" tab next to "Stages".
- [ ] **Step 6: Gates** — lint + type-check + build
- [ ] **Step 7: Commit** — `git commit -am "feat(automation): Settings automation editors"`

---

## Self-Review Notes

- **Spec coverage:** §4 tables → WS1; §5 conditions/entry → WS2; §5 runActions + §5.1 ingest/changeDealStage wiring → WS3; §5 sla + §6 cron route → WS4; §7 config UI → WS5. Seed (§5.2) in WS1 migration. All in scope covered.
- **Placeholder scan:** no TBD/TODO; each code step shows concrete code or an exact behaviour list.
- **Type consistency:** `Condition`/`ConditionOp` (WS1) used by `evaluateCondition` (WS2), `entry.ts` (WS2), `sla.ts` (WS4), schemas (WS5). `runStageActions(dealId, stageId)` name identical in WS3 producer + changeDealStage/ingest/sla consumers. `resolveEntryStage(answers)` identical in WS2 producer + WS3 ingest. `scanDueSlaRules()` identical in WS4 producer + cron route. StageAction excludes move_stage in both the DB check (WS1) and the Zod schema (WS5).
- **Loop guard:** `stage_actions.action_type` cannot be `move_stage` (DB check + Zod); only `sla_rules` move stages, each at-most-once per stage-entry via `automation_runs` unique index.
- **Behaviour preservation:** the WS1 seed reproduces v1 (default entry rule → Payment Link Sent → create link + send enrollment_link), so the ingest reshape (WS3) is behaviour-neutral for the direct-pay path; existing ingest/GST tests must stay green.
- **ENV-PENDING:** apply migration 0004; live entry routing + on-enter link/WhatsApp on a real submission; SLA firing on schedule (Railway cron with CRON_SECRET, or manual curl); reminder + auto-Closed-Lost end-to-end.

## Workstream 6: formrunner-confirmation (link-less entry routes)

### Task 6.1: FormRunner handles a null payment link

**Files:**
- Modify: `src/app/f/[slug]/FormRunner.tsx`
- Modify: `src/app/f/[slug]/thank-you/page.tsx` (if needed for the no-payment copy)

**Interfaces:**
- Consumes: the ingest response `{ success: boolean, payment_link: string | null }`.
- Produces: on `success:true` with `payment_link` present → redirect to the link (unchanged); on `success:true` with `payment_link === null` → show an in-form confirmation state ("Thanks — we've got your details and someone from the team will be in touch shortly on WhatsApp."), NOT the error state.

- [ ] **Step 1: Locate the submit handler** in `FormRunner.tsx` where the ingest response is used (currently `window.location = payment_link` and null is treated as an error). Add a `submitted` success state.
- [ ] **Step 2: Implement** — after a successful POST: if `data.payment_link` is a non-empty string, `window.location.assign(data.payment_link)`; else set a `confirmed` state that renders a full-screen confirmation panel (design tokens: accent kicker, message, no inputs). Only treat `data.success === false` (or a network/HTTP error) as the error state.
- [ ] **Step 3: Copy** — confirmation heading + subtext; reuse the form's product context. Keep it consistent with the thank-you page styling.
- [ ] **Step 4: Gates** — lint + type-check + build
- [ ] **Step 5: Commit** — `git commit -am "feat(form): show confirmation when a submission routes to a no-payment stage"`

Note: end-to-end verification is ENV-PENDING (needs migration 0004 applied + an entry rule routing to a stage without a create_payment_link action, e.g. Call Requested).
