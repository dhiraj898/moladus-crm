import 'server-only'
import { getServiceClient } from '@/lib/supabase/server'
import { runStageActions } from './runActions'
import { logActivity } from '@/features/crm/activities/service'

/**
 * System (NULL-actor) stage move (design §5.1).
 *
 * Reproduces the committed effects of the `changeDealStage` server action —
 * update `stage_id` + `stage_entered_at`, append a `deal_stage_events` row with a
 * NULL (system) actor, log a `stage_change` activity carrying `metadata.via` —
 * and then invokes `runStageActions` on the destination so the move triggers the
 * same on-enter actions as any other transition.
 *
 * We deliberately do NOT call the exported `changeDealStage` server action: it is
 * `'use server'` (its arguments are client-controllable) and is auth-gated via
 * `getCurrentUser()`. System callers (the SLA scanner, the Razorpay webhook) run
 * with no user session, and adding a bypass argument to a client-invocable action
 * would be an auth hole. `move_stage` is not a valid on-enter action, so this
 * cannot recurse into another move.
 *
 * The stage `update` error is thrown so the caller decides fatality (the SLA
 * scanner logs it as a failed run; the webhook swallows it to protect the 200
 * ack). This module is `server-only` and reaches the DB solely through the
 * service-role client.
 *
 * @param dealId  the deal to move
 * @param toStageId  the destination stage id
 * @param opts.via  provenance tag written to the `stage_change` activity
 *   (`'sla'`, `'payment'`, …); omitted → null
 * @param opts.fromStageId  the origin stage id, used only to resolve the
 *   human-readable `from` name for the timeline entry (best-effort)
 */
export async function moveDealStageAsSystem(
  dealId: string,
  toStageId: string,
  opts: { via?: string; fromStageId?: string | null } = {}
): Promise<void> {
  const supabase = getServiceClient()
  const fromStageId = opts.fromStageId ?? null

  // Resolve human-readable stage names for the timeline entry (best-effort).
  const ids = Array.from(new Set([fromStageId, toStageId].filter(Boolean))) as string[]
  const nameById = new Map<string, string>()
  if (ids.length > 0) {
    const { data: stageRows } = await supabase.from('stages').select('id, name').in('id', ids)
    for (const s of (stageRows ?? []) as { id: string; name: string }[]) {
      nameById.set(s.id, s.name)
    }
  }

  const now = new Date().toISOString()

  const { error: updateError } = await supabase
    .from('deals')
    .update({ stage_id: toStageId, stage_entered_at: now, updated_at: now })
    .eq('id', dealId)
  if (updateError) {
    throw new Error(`move_stage update failed: ${updateError.message}`)
  }

  // Audit trail — system move, so actor_id is null.
  await supabase.from('deal_stage_events').insert({
    deal_id: dealId,
    stage_id: toStageId,
    actor_id: null,
    entered_at: now,
  })

  await logActivity('deal', dealId, 'stage_change', {
    actorId: null,
    metadata: {
      from: fromStageId ? (nameById.get(fromStageId) ?? null) : null,
      to: nameById.get(toStageId) ?? null,
      via: opts.via ?? null,
    },
  })

  // Fire the destination stage's on-enter actions (send WhatsApp / create link).
  await runStageActions(dealId, toStageId)
}
