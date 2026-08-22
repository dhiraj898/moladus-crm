import 'server-only'
import { getEnv } from '@/lib/env'
import { getServiceClient } from '@/lib/supabase/server'
import { logActivity } from '@/features/crm/activities/service'

/**
 * AiSensy transactional WhatsApp sends (spec §9). Owned by Workstream 9.
 *
 * Two v1 templates:
 *   - `enrollment_link`    → fires on submission; carries student name + payment link
 *   - `enrollment_receipt` → fires on `paid`; carries student name + amount + product name
 *
 * Every send POSTs to the AiSensy campaign API, then writes a `notification_log`
 * row recording success/failure. Failures are logged and swallowed — a
 * notification failure must NEVER crash the caller (ingest pipeline or webhook),
 * so both wrappers return `{ ok: boolean }` and never throw.
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
    const env = getEnv()
    const res = await fetch(AISENSY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: env.AISENSY_API_KEY,
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

export async function sendEnrollmentLink(input: {
  dealId: string
  name: string
  whatsapp: string
  paymentLink: string
}): Promise<SendResult> {
  const { ok, error } = await sendTemplate('enrollment_link', input.whatsapp, [
    input.name,
    input.paymentLink,
  ])
  await logNotification(input.dealId, 'enrollment_link', ok, error)
  return { ok }
}

export async function sendReceipt(input: {
  dealId: string
  name: string
  whatsapp: string
  amount: number
  productName: string
}): Promise<SendResult> {
  const { ok, error } = await sendTemplate('enrollment_receipt', input.whatsapp, [
    input.name,
    // Coerce defensively: numeric columns can arrive as strings from supabase-js.
    Number(input.amount).toFixed(2),
    input.productName,
  ])
  await logNotification(input.dealId, 'enrollment_receipt', ok, error)
  return { ok }
}
