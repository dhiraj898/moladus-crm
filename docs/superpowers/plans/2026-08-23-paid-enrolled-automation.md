# Paid → Enrolled Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** On Razorpay `payment_link.paid`, auto-move the deal to the **Enrolled** stage as a system actor, which fires that stage's on-enter action (`molecule_enrollment_confirmed`), and STOP the unpaid SLA reminders. Remove the hardcoded `enrollment_receipt` send (the confirmation is now the Enrolled on-enter action — data-driven).

**Architecture:** Extract the system stage-move logic currently private in `src/features/crm/automation/sla.ts` (`dispatchMoveStage`) into a reusable `moveDealStageAsSystem(dealId, toStageId, opts)` in `src/features/crm/automation/moveStage.ts`; reuse it from both the SLA scanner and the Razorpay webhook. On paid, the webhook resolves the stage named `Enrolled` and calls it.

**Tech Stack:** Next.js 15 App Router, TS strict, Supabase service-role, Vitest.

## Global Constraints
- Webhook stays signature-verified + idempotent (`webhook_events`) — unchanged; the paid side-effects only run on a genuine transition (existing `transitioned.length>0` gate).
- `moveDealStageAsSystem` is server-only, uses the service client, writes `stage_id`+`stage_entered_at`, appends a `deal_stage_events` row with NULL actor, logs a `stage_change` activity (metadata `via`), then runs `runStageActions` on the destination. Best-effort in the webhook (a move failure must not break the 200 ack).
- No migration. Gates: `cd '/Users/dhirajghosal/Documents/Molades CRM' && npm run lint && npm run type-check && npm run build && npm run test`. Never `npm run dev` in a gate.

## Workstream 1: paid-enrolled

### Task 1.1: extract moveDealStageAsSystem (refactor + test)
**Files:** Create `src/features/crm/automation/moveStage.ts`, `moveStage.test.ts`; Modify `src/features/crm/automation/sla.ts`
**Produces:** `moveDealStageAsSystem(dealId: string, toStageId: string, opts?: { via?: string; fromStageId?: string | null }): Promise<void>` — reproduces `changeDealStage`'s committed effects with a NULL actor (update stage_id+stage_entered_at, insert deal_stage_events, log stage_change activity with `metadata.via`), then `runStageActions(dealId, toStageId)`. Throws on the stage update error (caller decides fatality).
- [ ] **Step 1:** Extract the body of `dispatchMoveStage` in `sla.ts` into `moveStage.ts` as `moveDealStageAsSystem`, generalized to take `(dealId, toStageId, opts)` (name-resolution + events + activity + runStageActions). Keep the same behavior.
- [ ] **Step 2:** Refactor `sla.ts`'s `dispatchMoveStage` to call `moveDealStageAsSystem(deal.id, toStageId, { via: 'sla', fromStageId: deal.stage_id })` (preserve the no-target-configured guard + its existing activity log).
- [ ] **Step 3:** Test `moveStage.test.ts` (mock service client + runStageActions): asserts it updates stage_id+stage_entered_at, inserts a deal_stage_events row with actor null, logs a stage_change activity, and calls runStageActions(dealId, toStageId).
- [ ] **Step 4: Gates.** Existing sla tests must stay green. **Commit** `refactor(automation): extract moveDealStageAsSystem, reuse in SLA scanner`.

### Task 1.2: webhook paid → Enrolled + drop hardcoded receipt
**Files:** Modify `src/app/api/webhooks/razorpay/route.ts`; `src/features/aisensy/send.ts` (remove now-unused `sendReceipt` if nothing else imports it) ; `src/app/api/webhooks/razorpay/route.test.ts`
**Consumes:** `moveDealStageAsSystem` (1.1), `getServiceClient`.
- [ ] **Step 1:** In the webhook, in the `paid` + genuine-transition branch: resolve the Enrolled stage id — `select id from stages where name = 'Enrolled' limit 1`. If found, `await moveDealStageAsSystem(dealId, enrolledId, { via: 'payment' })` inside a try/catch (log + swallow — never break the 200 ack). Remove the `sendReceipt(...)` call (the confirmation is now the Enrolled on-enter action). Keep the `logActivity('deal', dealId, 'payment', ...)` payment event.
- [ ] **Step 2:** If `sendReceipt` is now unused anywhere, remove it from `src/features/aisensy/send.ts` (and its test refs); if still referenced elsewhere, leave it. Verify with grep.
- [ ] **Step 3:** Update `route.test.ts`: on a valid `paid` webhook, assert the deal is moved to the Enrolled stage (mock the stage lookup + moveDealStageAsSystem) and that no `enrollment_receipt` send happens. Keep the existing 401/400/503/200 + idempotency cases green.
- [ ] **Step 4: Gates. Commit** `feat(webhook): paid auto-moves deal to Enrolled (fires confirmation on-enter), drop hardcoded receipt`.

## Self-Review Notes
- Coverage: extract+reuse (1.1), webhook wiring + receipt removal (1.2). Matches the goal.
- Reminders stop on paid: once moved to Enrolled, the deal leaves Payment Link Sent so SLA rules (from_stage=Payment Link Sent) no longer select it; the SLA condition also requires payment_status≠paid — double protection.
- Idempotency: the move runs only inside the existing `transitioned.length>0` genuine-transition gate, so a replayed paid webhook won't re-move.
- `via:'payment'` distinguishes this transition in the activity timeline from `sla`/manual moves.
- ENV-PENDING: live confirmation requires a real AiSensy key + a real paid webhook; verify a paid deal lands in Enrolled and `molecule_enrollment_confirmed` is logged in notifications.
