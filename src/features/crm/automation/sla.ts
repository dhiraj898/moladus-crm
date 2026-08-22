import 'server-only'
import { getServiceClient } from '@/lib/supabase/server'
import { evaluateCondition } from './conditions'
import { runStageActions } from './runActions'
import { sendWhatsAppTemplate } from '@/features/aisensy/send'
import { logActivity } from '@/features/crm/activities/service'
import type { Contact, Deal, Product, SlaRule } from '@/lib/supabase/types'

/**
 * Time-based SLA scanner (design §5 + §8, plan WS4 Task 4.1).
 *
 * For each active `sla_rule` it finds *due* deals — those sitting in the rule's
 * `from_stage_id` for at least `delay_minutes` (`stage_entered_at <= now -
 * delay`) — evaluates the rule's `condition` against the deal row, and, when it
 * holds, fires the rule's action exactly once per (deal, rule, stage-entry).
 *
 * At-most-once (design §8): the `automation_runs` unique index
 * `(deal_id, sla_rule_id, stage_entered_at)` is the guard. We INSERT the guard
 * row FIRST; a unique-violation means another scan (or an earlier pass) already
 * fired this rule for this stage-entry, so we skip. The guard is written
 * whenever the rule fires — success OR dispatch failure — so a failed reminder
 * is visible on the timeline for manual follow-up and is NEVER auto-retried
 * (avoids duplicate WhatsApp sends). Concurrent scans are safe: the losing
 * insert hits the unique index and is skipped.
 *
 * Best-effort: every deal is wrapped in try/catch; a single deal's failure is
 * logged to `activities` and the batch continues. `scanDueSlaRules` resolves to
 * the count of rules fired this pass.
 *
 * This module is `server-only` and reaches the DB solely through the
 * service-role client (RLS is deny-all on every automation table); it is invoked
 * from the secret-protected `/api/cron/scan` route, never from the client.
 */

/** Postgres unique-violation SQLSTATE — the `automation_runs_once` index. */
const UNIQUE_VIOLATION = '23505'

type Supa = ReturnType<typeof getServiceClient>

export async function scanDueSlaRules(): Promise<{ fired: number }> {
  const supabase = getServiceClient()

  let rules: SlaRule[]
  try {
    const { data, error } = await supabase.from('sla_rules').select('*').eq('active', true)
    if (error) {
      console.error(`scanDueSlaRules: failed to load rules: ${error.message}`)
      return { fired: 0 }
    }
    rules = (data ?? []) as SlaRule[]
  } catch (err) {
    console.error('scanDueSlaRules: load threw:', err)
    return { fired: 0 }
  }

  const nowMs = Date.now()
  let fired = 0

  for (const rule of rules) {
    const cutoff = new Date(nowMs - rule.delay_minutes * 60_000).toISOString()

    let deals: Deal[]
    try {
      const { data, error } = await supabase
        .from('deals')
        .select('*')
        .eq('stage_id', rule.from_stage_id)
        .lte('stage_entered_at', cutoff)
      if (error) {
        console.error(`scanDueSlaRules: deal query failed for rule ${rule.id}: ${error.message}`)
        continue
      }
      deals = (data ?? []) as Deal[]
    } catch (err) {
      console.error(`scanDueSlaRules: deal query threw for rule ${rule.id}:`, err)
      continue
    }

    for (const deal of deals) {
      // stage_entered_at is part of the guard key; a due deal always has one,
      // but guard defensively so the unique tuple is never null.
      if (!deal.stage_entered_at) continue

      // Evaluate the condition against the deal row itself.
      if (!evaluateCondition(rule.condition, deal as unknown as Record<string, unknown>)) {
        continue
      }

      try {
        const claimed = await claimRun(supabase, deal.id, rule.id, deal.stage_entered_at)
        if (!claimed) continue // already fired for this stage-entry

        fired++ // guard written → this rule has fired (at-most-once)

        // Dispatch is best-effort; a failure is logged but the guard stays, so
        // the reminder is not re-sent on the next scan.
        await dispatch(supabase, rule, deal)
      } catch (err) {
        const note = err instanceof Error ? err.message : 'unknown error'
        await logActivity(
          'deal',
          deal.id,
          rule.action_type === 'move_stage' ? 'stage_change' : 'notification',
          {
            body: `SLA rule ${rule.id} (${rule.action_type}) failed: ${note}`,
            metadata: {
              status: 'sla_failed',
              sla_rule_id: rule.id,
              action_type: rule.action_type,
            },
          }
        )
      }
    }
  }

  return { fired }
}

/**
 * Write the at-most-once guard row. Returns `true` when the row was inserted
 * (this scan claims the firing), `false` on a unique-violation (already fired
 * for this stage-entry). Any other DB error throws so the caller logs it and
 * does NOT dispatch (no un-guarded firing).
 */
async function claimRun(
  supabase: Supa,
  dealId: string,
  slaRuleId: string,
  stageEnteredAt: string
): Promise<boolean> {
  const { error } = await supabase.from('automation_runs').insert({
    deal_id: dealId,
    sla_rule_id: slaRuleId,
    stage_entered_at: stageEnteredAt,
  })
  if (!error) return true
  if ((error as { code?: string }).code === UNIQUE_VIOLATION) return false
  throw new Error(`Failed to claim SLA run: ${(error as { message?: string }).message}`)
}

/** Fire the rule's action. Guarded already; never called twice for a firing. */
async function dispatch(supabase: Supa, rule: SlaRule, deal: Deal): Promise<void> {
  if (rule.action_type === 'send_whatsapp') {
    await dispatchSendWhatsApp(supabase, rule, deal)
  } else if (rule.action_type === 'move_stage') {
    await dispatchMoveStage(supabase, rule, deal)
  }
}

/**
 * `send_whatsapp` SLA action — send the configured AiSensy template to the
 * deal's contact. Params mirror the on-enter runner's superset ordering
 * (`[name, paymentLink, productName]`) so a reminder template can carry the
 * (still-unpaid) payment link. The send helper writes the notification_log +
 * `notification` activity trail and never throws.
 */
async function dispatchSendWhatsApp(supabase: Supa, rule: SlaRule, deal: Deal): Promise<void> {
  const template =
    typeof rule.config.template === 'string' ? rule.config.template.trim() : ''
  if (!template) {
    await logActivity('deal', deal.id, 'notification', {
      body: `SLA rule ${rule.id} send_whatsapp skipped: no template configured.`,
      metadata: { status: 'sla_failed', sla_rule_id: rule.id, action_type: 'send_whatsapp' },
    })
    return
  }

  const contact = await loadContact(supabase, deal.contact_id)
  if (!contact?.whatsapp_number) {
    await logActivity('deal', deal.id, 'notification', {
      body: `SLA rule ${rule.id} send_whatsapp (${template}) skipped: no WhatsApp number.`,
      metadata: { status: 'sla_failed', sla_rule_id: rule.id, action_type: 'send_whatsapp' },
    })
    return
  }

  const product = await loadProduct(supabase, deal.product_id)
  const name = contact.name ?? 'there'
  const paymentLink = deal.razorpay_payment_link_url ?? ''
  const productName = product?.name ?? ''

  await sendWhatsAppTemplate({
    dealId: deal.id,
    template,
    whatsapp: contact.whatsapp_number,
    params: [name, paymentLink, productName],
  })
}

/**
 * `move_stage` SLA action — move the deal to `config.to_stage_id` as a SYSTEM
 * actor and run that stage's on-enter actions.
 *
 * We deliberately do NOT call the exported `changeDealStage` server action: it
 * is `'use server'` (so its arguments are client-controllable) and is auth-gated
 * via `getCurrentUser()`. The scanner runs from the cron route with no user
 * session, and adding a bypass argument to a client-invocable action would be an
 * auth hole. Instead we reproduce `changeDealStage`'s committed effects here —
 * update `stage_id` + `stage_entered_at`, append a `deal_stage_events` row with a
 * NULL (system) actor, log a `stage_change` activity — and then invoke
 * `runStageActions` on the destination, so the SLA move triggers the same
 * on-enter actions as any other transition (design §5.1). `move_stage` is not a
 * valid on-enter action, so this cannot recurse into another move.
 */
async function dispatchMoveStage(supabase: Supa, rule: SlaRule, deal: Deal): Promise<void> {
  const toStageId =
    typeof rule.config.to_stage_id === 'string' ? rule.config.to_stage_id.trim() : ''
  if (!toStageId) {
    await logActivity('deal', deal.id, 'stage_change', {
      body: `SLA rule ${rule.id} move_stage skipped: no target stage configured.`,
      metadata: { status: 'sla_failed', sla_rule_id: rule.id, action_type: 'move_stage' },
    })
    return
  }

  // Resolve human-readable stage names for the timeline entry (best-effort).
  const fromStageId = deal.stage_id
  const ids = Array.from(new Set([fromStageId, toStageId].filter(Boolean))) as string[]
  const nameById = new Map<string, string>()
  const { data: stageRows } = await supabase.from('stages').select('id, name').in('id', ids)
  for (const s of ((stageRows ?? []) as { id: string; name: string }[])) {
    nameById.set(s.id, s.name)
  }

  const now = new Date().toISOString()

  const { error: updateError } = await supabase
    .from('deals')
    .update({ stage_id: toStageId, stage_entered_at: now, updated_at: now })
    .eq('id', deal.id)
  if (updateError) {
    throw new Error(`move_stage update failed: ${updateError.message}`)
  }

  // Audit trail — system move, so actor_id is null.
  await supabase.from('deal_stage_events').insert({
    deal_id: deal.id,
    stage_id: toStageId,
    actor_id: null,
    entered_at: now,
  })

  await logActivity('deal', deal.id, 'stage_change', {
    actorId: null,
    metadata: {
      from: fromStageId ? (nameById.get(fromStageId) ?? null) : null,
      to: nameById.get(toStageId) ?? null,
      via: 'sla',
      sla_rule_id: rule.id,
    },
  })

  // Fire the destination stage's on-enter actions (send WhatsApp / create link).
  await runStageActions(deal.id, toStageId)
}

async function loadContact(
  supabase: Supa,
  contactId: string | null
): Promise<Pick<Contact, 'name' | 'whatsapp_number'> | null> {
  if (!contactId) return null
  const { data } = await supabase
    .from('contacts')
    .select('name, whatsapp_number')
    .eq('id', contactId)
    .maybeSingle()
  return (data as Pick<Contact, 'name' | 'whatsapp_number'> | null) ?? null
}

async function loadProduct(
  supabase: Supa,
  productId: string | null
): Promise<Pick<Product, 'name'> | null> {
  if (!productId) return null
  const { data } = await supabase
    .from('products')
    .select('name')
    .eq('id', productId)
    .maybeSingle()
  return (data as Pick<Product, 'name'> | null) ?? null
}
