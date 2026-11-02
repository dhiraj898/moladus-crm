import 'server-only'
import { getEnv } from '@/lib/env'
import { getServiceClient } from '@/lib/supabase/server'
import { createPaymentLink } from '@/features/razorpay/paymentLink'
import { sendWhatsAppTemplate } from '@/features/aisensy/send'
import { logActivity } from '@/features/crm/activities/service'
import { loadLineSummary, loadOrderDetail } from './orderSummary'
import {
  paramTokensFromConfig,
  resolveTemplateParams,
  tokensNeedPaymentLink,
} from './templateParams'
import { formatMoney } from '@/features/form-engine/estimate'
import type { Contact, Deal, StageAction } from '@/lib/supabase/types'

/**
 * On-enter stage action runner (design §5, plan WS3 Task 3.1).
 *
 * When a deal ENTERS a stage — via entry routing on ingest, a manual
 * `changeDealStage`, or an SLA `move_stage` — the stage's configured
 * `stage_actions` run once, in `run_order`. Two action types exist:
 *   - `create_payment_link` → mint a Razorpay link, persist it on the deal, and
 *     advance `payment_status` to `link_sent` (idempotent: skipped if the deal
 *     already has a link).
 *   - `send_whatsapp` → send the configured AiSensy template (the send helper
 *     logs a `notification_log` row + `notification` activity itself).
 *
 * `move_stage` is deliberately NOT an on-enter action (loop guard — only SLA
 * rules move stages), enforced by the DB check and the config Zod schema.
 *
 * Best-effort by contract: EACH action is wrapped so a failure logs to the
 * timeline and the runner continues; `runStageActions` NEVER throws to its
 * caller. This lets the ingest pipeline, `changeDealStage`, and the SLA scanner
 * treat on-enter actions as fire-and-forget side effects that can never brick
 * the transition that already committed.
 *
 * `getServiceClient` is `server-only`, so this only ever runs server-side.
 */
export async function runStageActions(dealId: string, stageId: string): Promise<void> {
  let actions: StageAction[]
  try {
    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('stage_actions')
      .select('*')
      .eq('stage_id', stageId)
      .eq('active', true)
      .order('run_order', { ascending: true })

    if (error) {
      console.error(`runStageActions: failed to load actions: ${error.message}`)
      return
    }
    actions = (data ?? []) as StageAction[]
  } catch (err) {
    console.error('runStageActions: load threw:', err)
    return
  }

  for (const action of actions) {
    try {
      if (action.action_type === 'create_payment_link') {
        await runCreatePaymentLink(dealId)
      } else if (action.action_type === 'send_whatsapp') {
        await runSendWhatsApp(dealId, action)
      }
    } catch (err) {
      // Best-effort: an action failure is logged and never propagates. Type the
      // timeline entry by the action (payment for create_payment_link,
      // notification for send_whatsapp) so it matches the success-path typing.
      const note = err instanceof Error ? err.message : 'unknown error'
      const activityType =
        action.action_type === 'send_whatsapp' ? 'notification' : 'payment'
      await logActivity('deal', dealId, activityType, {
        body: `On-enter ${action.action_type} failed: ${note}`,
        metadata: { status: 'action_failed', action_type: action.action_type },
      })
    }
  }
}

/** Deal columns the on-enter actions need. */
type DealCtx = Pick<
  Deal,
  | 'id'
  | 'lead_id'
  | 'contact_id'
  | 'product_id'
  | 'total_amount'
  | 'razorpay_payment_link_url'
>

async function loadDeal(dealId: string): Promise<DealCtx | null> {
  const supabase = getServiceClient()
  const { data } = await supabase
    .from('deals')
    .select('id, lead_id, contact_id, product_id, total_amount, razorpay_payment_link_url')
    .eq('id', dealId)
    .maybeSingle()
  return (data as DealCtx | null) ?? null
}

async function loadContact(
  contactId: string | null
): Promise<Pick<Contact, 'name' | 'email' | 'whatsapp_number'> | null> {
  if (!contactId) return null
  const supabase = getServiceClient()
  const { data } = await supabase
    .from('contacts')
    .select('name, email, whatsapp_number')
    .eq('id', contactId)
    .maybeSingle()
  return (data as Pick<Contact, 'name' | 'email' | 'whatsapp_number'> | null) ?? null
}

/**
 * Resolve the payment-link callback URL. In v1 the link redirected to the
 * submitting form's thank-you page (`/f/{slug}/thank-you`); we recover the slug
 * via the deal's lead → form so direct-pay behaviour is preserved. If the deal
 * has no lead/form (e.g. a manually-created deal), we fall back to the app root.
 */
async function resolveCallbackUrl(leadId: string | null): Promise<string> {
  const env = getEnv()
  const base = env.NEXT_PUBLIC_APP_URL
  if (!leadId) return base

  const supabase = getServiceClient()
  const { data: leadRow } = await supabase
    .from('leads')
    .select('form_id')
    .eq('id', leadId)
    .maybeSingle()
  const formId = (leadRow as { form_id: string | null } | null)?.form_id ?? null
  if (!formId) return base

  const { data: formRow } = await supabase
    .from('forms')
    .select('slug')
    .eq('id', formId)
    .maybeSingle()
  const slug = (formRow as { slug: string } | null)?.slug ?? null
  return slug ? `${base}/f/${slug}/thank-you` : base
}

/**
 * `create_payment_link` on-enter action. Mints a Razorpay link for the deal's
 * GST-inclusive total, persists the link fields, and advances the deal to
 * `link_sent`. Idempotent: if the deal already carries a link (a re-enter, or a
 * prior run), it is a no-op so a second transition never double-charges.
 */
async function runCreatePaymentLink(dealId: string): Promise<void> {
  const supabase = getServiceClient()
  const deal = await loadDeal(dealId)
  if (!deal) {
    await logActivity('deal', dealId, 'payment', {
      body: 'On-enter create_payment_link skipped: deal not found.',
      metadata: { status: 'action_failed', action_type: 'create_payment_link' },
    })
    return
  }

  // Idempotent re-enter: a link already exists, nothing to do.
  if (deal.razorpay_payment_link_url) return

  const contact = await loadContact(deal.contact_id)
  if (!contact) {
    await logActivity('deal', dealId, 'payment', {
      body: 'On-enter create_payment_link skipped: contact not found.',
      metadata: { status: 'action_failed', action_type: 'create_payment_link' },
    })
    return
  }

  // Order-level: a multi-line order has `product_id` null (one row per
  // `deal_items`). Razorpay gets the FULL item list — every product name in the
  // description, and an itemized "name ₹total" breakdown plus the order total in
  // `notes` — so the payer sees exactly what they are paying for. Legacy
  // single-product deals resolve to that one product. The amount is the deal's
  // GST-inclusive `total_amount` either way.
  const { description, itemsNote } = await loadOrderDetail(dealId, deal.product_id)

  const callbackUrl = await resolveCallbackUrl(deal.lead_id)

  const link = await createPaymentLink({
    amountPaise: Math.round(Number(deal.total_amount) * 100),
    description,
    customer: {
      name: contact.name ?? 'Student',
      email: contact.email ?? undefined,
      contact: contact.whatsapp_number,
    },
    callbackUrl,
    referenceId: dealId,
    notes: {
      deal_id: dealId,
      product_id: deal.product_id ?? '',
      items: itemsNote,
      order_total: Number(deal.total_amount),
    },
  })

  await supabase
    .from('deals')
    .update({
      razorpay_payment_link_id: link.id,
      razorpay_payment_link_url: link.short_url,
      payment_status: 'link_sent',
      updated_at: new Date().toISOString(),
    })
    .eq('id', dealId)

  await logActivity('deal', dealId, 'payment', {
    metadata: { status: 'link_sent' },
  })
}

/**
 * `send_whatsapp` on-enter action. Sends the configured AiSensy template to the
 * deal's contact. Params are built per-template so the seeded `enrollment_link`
 * action reproduces v1 exactly (`[name, paymentLink]`); the deal is re-read here
 * so a `create_payment_link` action ordered before this one supplies the fresh
 * link. The send helper writes the notification_log + activity trail.
 */
async function runSendWhatsApp(dealId: string, action: StageAction): Promise<void> {
  const template =
    typeof action.config.template === 'string' ? action.config.template.trim() : ''
  if (!template) {
    await logActivity('deal', dealId, 'notification', {
      body: 'On-enter send_whatsapp skipped: no template configured.',
      metadata: { status: 'action_failed', action_type: 'send_whatsapp' },
    })
    return
  }

  const deal = await loadDeal(dealId)
  const contact = await loadContact(deal?.contact_id ?? null)
  if (!contact?.whatsapp_number) {
    await logActivity('deal', dealId, 'notification', {
      body: `On-enter send_whatsapp (${template}) skipped: no WhatsApp number.`,
      metadata: { status: 'action_failed', action_type: 'send_whatsapp' },
    })
    return
  }

  const name = contact.name ?? 'there'
  const paymentLink = deal?.razorpay_payment_link_url ?? ''
  const productName = await loadLineSummary(dealId, deal?.product_id ?? null)
  const amount = deal ? formatMoney(Number(deal.total_amount)) : ''
  const email = contact.email ?? ''

  // Which params this template's config declares (falls back to the default
  // order). AiSensy rejects (400) a send whose param count differs from the
  // approved campaign's variables, so the config is the source of truth.
  const tokens = paramTokensFromConfig(action.config)

  // Link-dependent templates carry the payment link as a param. If the link is
  // missing (e.g. an earlier `create_payment_link` action failed on a Razorpay
  // outage — each on-enter action is independently try/caught and continues on
  // failure), dispatching would send a message with a BLANK link. Skip and log
  // instead, so a real student never receives a broken enrollment WhatsApp. The
  // deal stays open+unlinked and is resumable on a later submission.
  if (tokensNeedPaymentLink(tokens) && !paymentLink) {
    await logActivity('deal', dealId, 'notification', {
      body: `On-enter send_whatsapp (${template}) skipped: payment link not available.`,
      metadata: { status: 'action_failed', action_type: 'send_whatsapp' },
    })
    return
  }

  await sendWhatsAppTemplate({
    dealId,
    template,
    whatsapp: contact.whatsapp_number,
    name,
    params: resolveTemplateParams(tokens, {
      name,
      paymentLink,
      productName,
      amount,
      email,
    }),
  })
}

