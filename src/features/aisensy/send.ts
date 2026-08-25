import 'server-only'
import { getSecret } from '@/features/integrations/secrets'
import { getServiceClient } from '@/lib/supabase/server'
import { logActivity } from '@/features/crm/activities/service'

/**
 * AiSensy transactional WhatsApp sends (spec §9). Owned by Workstream 9.
 *
 * All sends flow through the generic `sendWhatsAppTemplate` helper, driven by the
 * on-enter action runner (`runStageActions`): the approved AiSensy template and
 * its params come from `stage_actions` config, so confirmation/receipt messages
 * are configured per stage rather than hardcoded here.
 *
 * Every send POSTs to the AiSensy campaign API, then writes a `notification_log`
 * row recording success/failure. Failures are logged and swallowed — a
 * notification failure must NEVER crash the caller (ingest pipeline or webhook),
 * so the wrapper returns `{ ok: boolean }` and never throws.
 *
 * ENV-PENDING: live delivery needs `AISENSY_API_KEY` set in Railway and the two
 * templates approved in the AiSensy console under the exact campaign names above.
 * Manual test once keys exist: submit a form (or replay a `payment_link.paid`
 * webhook), then confirm the WhatsApp message arrives AND a matching
 * `notification_log` row exists with `status = 'sent'`. Force a failure by using a
 * bad key and confirm the row is written with `status = 'failed'` + `error_message`
 * while the pipeline/webhook still completes.
 */

const AISENSY_ENDPOINT = 'https://backend.aisensy.com/campaign/t1/api/v2'

interface SendResult {
  ok: boolean
}

async function sendTemplate(
  template: string,
  whatsapp: string,
  params: string[],
): Promise<{ ok: boolean; error?: string }> {
  try {
    // Resolve the API key via the secret store (DB override, then env). Fail
    // soft when it is unset so a missing key logs + returns not-sent rather than
    // ever crashing the ingest pipeline or webhook that called us.
    const apiKey = await getSecret('AISENSY_API_KEY')
    if (!apiKey) {
      return { ok: false, error: 'AiSensy API key not configured' }
    }
    const res = await fetch(AISENSY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        campaignName: template,
        destination: whatsapp,
        templateParams: params,
      }),
    })
    if (!res.ok) {
      return { ok: false, error: `AiSensy responded ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown error' }
  }
}

async function logNotification(
  dealId: string,
  template: string,
  ok: boolean,
  error?: string,
): Promise<void> {
  const status = ok ? 'sent' : 'failed'
  try {
    const supabase = getServiceClient()
    await supabase.from('notification_log').insert({
      deal_id: dealId,
      channel: 'whatsapp',
      template,
      status,
      sent_at: ok ? new Date().toISOString() : null,
      error_message: error ?? null,
    })
  } catch {
    // Logging must never throw to the caller.
  }

  // Mirror the send onto the deal's activity timeline. `logActivity` is
  // best-effort (it swallows every error), so this can never break the send
  // pipeline or the webhook that ultimately called it.
  await logActivity('deal', dealId, 'notification', {
    body: template,
    metadata: { status },
  })
}

/**
 * Generic logged template send, for the data-driven on-enter action runner
 * (`runStageActions`). Sends an arbitrary approved AiSensy template with the
 * caller-built param list, then writes the same `notification_log` +
 * `notification` activity trail as the typed wrappers below. Best-effort: it
 * returns `{ ok }` and never throws, so a notification failure can never break
 * the stage transition that triggered it.
 */
export async function sendWhatsAppTemplate(input: {
  dealId: string
  template: string
  whatsapp: string
  params: string[]
}): Promise<SendResult> {
  const { ok, error } = await sendTemplate(input.template, input.whatsapp, input.params)
  await logNotification(input.dealId, input.template, ok, error)
  return { ok }
}
