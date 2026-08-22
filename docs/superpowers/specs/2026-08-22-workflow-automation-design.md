# Spec 2 — Workflow Automation — Design

**Date:** 2026-08-22
**Status:** Draft (awaiting review)
**Phase:** 2 of 6 in the roadmap. Builds on Spec 1 (CRM Depth, merged: `stages`, `deal_stage_events`, `activities`, `deals.stage_id`/`stage_entered_at`).

---

## 1. Goal

Let admins configure — without code — what happens as a deal moves through the pipeline: route a new submission to a stage based on form answers, fire actions when a deal enters a stage (send a WhatsApp template, create a Razorpay payment link), and run time-based rules (unpaid reminders at T+1/T+2, then auto-move to Closed Lost).

Modeled as a **bounded, data-driven state machine** (Zoho-Blueprint style) — NOT a visual workflow designer or scripting DSL. Config is CRUD over a few tables; a small deterministic engine interprets it.

---

## 2. Scope

**In scope**
- **Entry rules** — on form submit, first-matching condition over form answers sets the initial stage.
- **Stage on-enter actions** — when a deal enters a stage, run ordered actions (`send_whatsapp`, `create_payment_link`).
- **Time/SLA rules** — for a stage, after a configurable delay and a condition (e.g. still unpaid), fire an action (`send_whatsapp` reminder or `move_stage`).
- **Ingest reshape** — payment-link creation moves out of the ingest route and becomes an on-enter action of the Payment stage; ingest routes via entry rules then runs on-enter actions.
- **Manual stage change** (Spec 1's `changeDealStage`) also runs on-enter actions.
- **Scanner** — a secret-protected `/api/cron/scan` route that fires due SLA rules; idempotent. Scheduled firing wired at Railway deploy (ENV-PENDING until then).
- **Automation config UI** under Settings.
- **Condition evaluator** — a JSON `{field, op, value}` predicate.

**Out of scope (later)**
- Visual drag-drop workflow designer; nested AND/OR condition groups; scripting/DSL.
- Generic "any object/any field" engine (deal-stage scoped only).
- RBAC (Spec 3), custom fields (Spec 4), form embed (Spec 5), AiSensy chat (Spec 6).
- The actual Railway deploy + cron registration (separate deploy step; this spec makes the route + logic ready).

---

## 3. Locked decisions (brainstorming 2026-08-22)

1. Bounded state machine + CRUD Settings; no visual designer, no DSL.
2. Entry routing = first-match condition over form answers; admin adds the routing field (e.g. a yes/no "want a call before paying?") to the form.
3. Payment-link creation becomes an on-enter action of the Payment stage (ingest reshaped).
4. Reminders: build scan-and-fire logic + a secured cron route now; scheduled firing is ENV-PENDING until Railway deploy.
5. Conditions are a single `{field, op, value}` predicate (ops: `eq`, `neq`, `in`, `not_in`, `is_empty`, `not_empty`). Groups deferred.
6. On-enter actions run imperatively at the transition point (entry routing, manual change, SLA move) — so they fire exactly once per transition. Only SLA rules use the scanner and need dedup.

---

## 4. Data model

New migration: `supabase/migrations/0004_workflow_automation.sql`. All tables RLS deny-all (service-role only).

### 4.1 `entry_rules`
```sql
create table entry_rules (
  id uuid primary key default gen_random_uuid(),
  condition jsonb,                 -- {field,op,value}; NULL = always-matches fallback
  to_stage_id uuid not null references stages(id),
  priority integer not null,       -- lower = evaluated first; first match wins
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```
`field` in a condition refers to a form-answer key. On submit, rules are evaluated by ascending `priority`; the first active rule whose condition matches (or is NULL) sets the initial stage. If none match, fall back to the `stages.is_default` stage.

### 4.2 `stage_actions`
```sql
create table stage_actions (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references stages(id) on delete cascade,
  action_type text not null check (action_type in ('send_whatsapp','create_payment_link')),
  config jsonb not null default '{}',   -- send_whatsapp: {template}; create_payment_link: {}
  run_order integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
```
Run in `run_order` when a deal **enters** this stage. `move_stage` is intentionally NOT an on-enter action (avoids auto-move loops); stage moves come from entry rules, manual change, or SLA rules.

### 4.3 `sla_rules`
```sql
create table sla_rules (
  id uuid primary key default gen_random_uuid(),
  from_stage_id uuid not null references stages(id) on delete cascade,
  delay_minutes integer not null check (delay_minutes > 0),
  condition jsonb,                 -- evaluated against the deal, e.g. {field:'payment_status',op:'neq',value:'paid'}
  action_type text not null check (action_type in ('send_whatsapp','move_stage')),
  config jsonb not null default '{}',   -- send_whatsapp: {template}; move_stage: {to_stage_id}
  active boolean not null default true,
  created_at timestamptz not null default now()
);
```
The scanner selects deals in `from_stage_id` where `now() - deals.stage_entered_at >= delay_minutes` and `condition` holds and this rule hasn't already fired for the current stage-entry.

### 4.4 `automation_runs` (idempotency + audit)
```sql
create table automation_runs (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  sla_rule_id uuid not null references sla_rules(id) on delete cascade,
  stage_entered_at timestamptz not null,   -- the deal's stage-entry this firing is tied to
  fired_at timestamptz not null default now()
);
create unique index automation_runs_once
  on automation_runs (deal_id, sla_rule_id, stage_entered_at);
```
The unique index makes each SLA rule fire **at most once per deal per stage-entry**. Re-entering a stage (new `stage_entered_at`) allows the rule to fire again.

### 4.5 Types
`src/lib/supabase/types.ts` gains `EntryRule`, `StageAction`, `SlaRule`, `AutomationRun`, and `Condition = {field:string; op:ConditionOp; value?:unknown}` with `ConditionOp = 'eq'|'neq'|'in'|'not_in'|'is_empty'|'not_empty'`.

---

## 5. Engine (`src/features/crm/automation/`)

- `conditions.ts` — `evaluateCondition(cond: Condition | null, ctx: Record<string, unknown>): boolean`. NULL → true. Pure, tested.
- `entry.ts` — `resolveEntryStage(answers): Promise<string>` — load active entry_rules by priority, return first match's `to_stage_id`, else the default stage id. Tested (with mocked rules).
- `runActions.ts` — `runStageActions(dealId: string, stageId: string): Promise<void>` — load active `stage_actions` for the stage ordered by `run_order`; execute each (`send_whatsapp` → AiSensy `sendTemplate`; `create_payment_link` → `createPaymentLink`, persist link fields + set `payment_status='link_sent'`); each action wrapped best-effort, logging an `activities` row; never throws to the caller.
- `sla.ts` — `scanDueSlaRules(): Promise<{fired:number}>` — for each active sla_rule, find due deals (in `from_stage`, elapsed ≥ delay, condition holds, no `automation_runs` row for `(deal, rule, stage_entered_at)`); fire the action (`send_whatsapp` or `move_stage` via `changeDealStage` with a system actor), insert the `automation_runs` guard row in the same step. Batched, uses `SELECT ... FOR UPDATE SKIP LOCKED` semantics via a claim-then-act pattern.
- Reuse: `evaluateCondition` shape mirrors the Spec 1 form-engine `visible_when` idea but is its own module (deal/answer context).

### 5.1 Wiring
- **Ingest reshape** (`src/app/api/ingest/route.ts`): after inserting the deal, call `resolveEntryStage(answers)` → set `stage_id` + `stage_entered_at` + opening `deal_stage_events` + `activities('created')`, then `runStageActions(dealId, stageId)`. Remove the inline `createPaymentLink` + `sendEnrollmentLink` calls (those become a `create_payment_link` + `send_whatsapp` on-enter action of the Payment stage, seeded by the migration). Idempotency/dedupe logic in ingest is unchanged.
- **Manual change** (`changeDealStage`, Spec 1): after updating stage + writing history, call `runStageActions(dealId, newStageId)`.
- **SLA move** uses `changeDealStage` with a null/system actor so it also triggers on-enter actions of the destination.

### 5.2 Seed (migration)
To preserve today's behaviour, the migration seeds: a `create_payment_link` (run_order 1) + `send_whatsapp {template:'enrollment_link'}` (run_order 2) on-enter action for the **Payment Link Sent** stage, and a default entry rule (NULL condition, lowest priority) → **Payment Link Sent**. So a direct-pay submission behaves exactly as v1 (deal → Payment Link Sent → link created + WhatsApp sent). Admins then add a higher-priority rule routing "want a call = yes" → Call Requested.

---

## 6. Scanner route

`src/app/api/cron/scan/route.ts` — `POST` (and `GET` for easy cron). Auth: `Authorization: Bearer ${CRON_SECRET}`; 401 otherwise. Calls `scanDueSlaRules()`, returns `{fired}`. New env var `CRON_SECRET` (added to `env.ts` + `.env.example`). Scheduled firing (every ~5 min) is set up at Railway deploy — ENV-PENDING until then; until deploy it's verifiable by `curl` with the secret.

---

## 7. Config UI (Settings → Automation)

New section `/admin/settings/automation`:
- **Entry rules** — ordered list: condition (`field` from the bound form's field keys, op, value) → target stage; priority reorder; active toggle; add/delete. A NULL-condition fallback row is shown as "Otherwise → {stage}".
- **Stage actions** — per stage, an ordered list of on-enter actions (type + config: template name for WhatsApp; create-payment-link has no config); reorder; active toggle.
- **SLA rules** — list: from-stage, delay (days + hours → minutes), condition, action (send WhatsApp template / move to stage); active toggle.

All CRUD via auth-gated server actions asserting `getCurrentUser()`. Design-system UI matching the Stages editor. Template-name fields are free text with a helper note that the template must be approved in AiSensy under that exact name.

---

## 8. Behaviour & edge cases

- **Loop guard:** on-enter actions cannot move stage; SLA `move_stage` can, but each SLA rule fires at most once per stage-entry (`automation_runs`), so a move → new stage-entry → different rules; a mis-configured cycle self-limits (each rule once per entry) and is flagged in the UI (warn if an SLA `move_stage` points back into a stage that routes to itself).
- **Best-effort actions:** any single action failure (AiSensy/Razorpay down) is logged to `activities` and does not block the transition or the scanner batch. SLA firings are **at-most-once**: the `automation_runs` guard row is written whenever the rule is fired (success or failure), and failures are logged to the timeline rather than auto-retried. Keeping it at-most-once avoids duplicate WhatsApp sends; a failed reminder is visible in the timeline for manual follow-up. (Auto-retry is a deliberate non-goal for v1.)
- **Scanner idempotency:** concurrent scans are safe via the `automation_runs` unique index (a duplicate insert is caught and that deal is skipped).
- **Missing template / stage config:** an action with an unknown template still calls AiSensy (which logs failed) — surfaced in the timeline; UI validates `to_stage_id` references a real stage.
- **payment_status stays auto** (Razorpay webhook); SLA conditions can read it (e.g. `payment_status neq paid`).

---

## 9. Testing

- `conditions.ts`: eq/neq/in/not_in/is_empty/not_empty true+false, NULL→true. (unit)
- `entry.ts`: first-match by priority; fallback to default when none match. (unit, mocked rules)
- `sla.ts`: selects only due+matching deals; dedups via automation_runs; move_stage vs send_whatsapp dispatch. (unit, mocked)
- Cron route: 401 without/with wrong secret; 200 + `{fired}` with correct secret. (unit)
- Gates per task: `npm run lint && npm run type-check && npm run build` (+ `npm run test`).

---

## 10. Workstreams (build order)

1. **db** — migration 0004 (4 tables + seed of default entry rule & Payment-stage actions) + types.
2. **engine-core** — `conditions.ts` + `entry.ts` (pure, tested).
3. **actions+ingest** — `runActions.ts`; reshape ingest; wire `changeDealStage`. (the behaviour-changing one)
4. **sla+cron** — `sla.ts` scanner + `/api/cron/scan` route + `CRON_SECRET` env (tested).
5. **automation-ui** — Settings → Automation (entry rules, stage actions, SLA rules editors) + actions.

---

## 11. ENV-PENDING (verify after apply/deploy)
Applying migration 0004; live entry-routing + on-enter link/WhatsApp on a real submission; SLA scan firing on schedule (needs Railway deploy + cron with `CRON_SECRET`, or manual `curl`); reminder + auto-Closed-Lost end-to-end.
