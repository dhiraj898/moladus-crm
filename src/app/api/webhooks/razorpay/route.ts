import { NextResponse } from 'next/server'
import type { PaymentStatus } from '@/lib/supabase/types'
import { getSecret } from '@/features/integrations/secrets'
import { getServiceClient } from '@/lib/supabase/server'
import { verifyRazorpaySignature } from '@/features/razorpay/verify'
import { sendReceipt } from '@/features/aisensy/send'
import { logActivity } from '@/features/crm/activities/service'

/**
 * Razorpay webhook handler (spec §8, §11).
 *
 * Durability + security contract:
 *  1. Verify the HMAC-SHA256 signature over the RAW request body. Invalid → 400,
 *     nothing is processed.
 *  2. Persist the raw event in `webhook_events`, idempotent on the Razorpay
 *     event id. A duplicate that is already processed short-circuits to 200.
 *  3. Update the matching deal by `razorpay_payment_link_id`, and on `paid`
 *     enqueue the receipt WhatsApp (failure logged, never fatal).
 *  4. Mark the event processed and return 200.
 *
 * Node runtime is required for `node:crypto` (used by the signature check).
 */
export const runtime = 'nodejs'

/** Map Razorpay payment-link events to our deal payment_status. */
const STATUS_BY_EVENT: Record<string, PaymentStatus> = {
  'payment_link.paid': 'paid',
  'payment_link.expired': 'link_expired',
  'payment_link.cancelled': 'failed',
}

interface RazorpayEntity {
  id?: string
}

interface RazorpayWebhookBody {
  event?: string
  payload?: {
    payment_link?: { entity?: RazorpayEntity }
    payment?: { entity?: RazorpayEntity }
  }
}

export async function POST(req: Request): Promise<Response> {
  // 0. Fail safe when the webhook secret is not configured yet (deploy-first,
  //    set-secret-after window). Resolve via getSecret (DB override, then env);
  //    when neither has it the route refuses cleanly instead of crashing.
  const secret = await getSecret('RAZORPAY_WEBHOOK_SECRET')
  if (!secret) {
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }

  // 1. Verify signature over the RAW body.
  const rawBody = await req.text()
  const signature = req.headers.get('x-razorpay-signature')
  if (!verifyRazorpaySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 })
  }

  // Parse only after the signature is trusted.
  let body: RazorpayWebhookBody
  try {
    body = JSON.parse(rawBody) as RazorpayWebhookBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const eventType = body.event ?? 'unknown'
  // Razorpay sends a unique id per delivery in this header; fall back to a
  // deterministic composite so idempotency still holds if it is ever absent.
  const paymentLinkId = body.payload?.payment_link?.entity?.id ?? null
  const eventId =
    req.headers.get('x-razorpay-event-id') ?? `${eventType}:${paymentLinkId ?? 'na'}`

  const supabase = getServiceClient()

  // 2. Durability + idempotency: record the raw event first.
  const { error: insertError } = await supabase.from('webhook_events').insert({
    provider: 'razorpay',
    event_id: eventId,
    payload: body,
    processed: false,
  })

  if (insertError) {
    // Unique violation → we have seen this event id before.
    if (insertError.code === '23505') {
      const { data: existing } = await supabase
        .from('webhook_events')
        .select('processed')
        .eq('event_id', eventId)
        .maybeSingle()
      if (existing?.processed) {
        // Already handled — acknowledge without reprocessing.
        return NextResponse.json({ ok: true, duplicate: true })
      }
      // Seen but not finished (a prior attempt crashed) — fall through to retry.
    } else {
      // Could not persist the event; ask Razorpay to retry later.
      return NextResponse.json({ error: 'storage error' }, { status: 500 })
    }
  }

  // 3. Apply the status change to the matching deal (if this event maps to one).
  const newStatus = STATUS_BY_EVENT[eventType]
  if (newStatus && paymentLinkId) {
    const { data: deal } = await supabase
      .from('deals')
      .select('id, contact_id, product_id, total_amount')
      .eq('razorpay_payment_link_id', paymentLinkId)
      .maybeSingle()

    if (deal) {
      const update: { payment_status: PaymentStatus; razorpay_ref?: string; updated_at: string } = {
        payment_status: newStatus,
        updated_at: new Date().toISOString(),
      }
      const paymentRef = body.payload?.payment?.entity?.id
      if (newStatus === 'paid' && paymentRef) {
        update.razorpay_ref = paymentRef
      }

      // Perform the update atomically at the DB level, gated on two conditions:
      //  - `.neq('payment_status', 'paid')` so a deal that is already `paid`
      //    never transitions away from it.
      //  - `.neq('payment_status', newStatus)` so re-applying the same status is
      //    a true no-op — the WHERE matches no row on a retry of an expired/
      //    failed event, whereas an unconditional UPDATE would re-match the row
      //    (and `select('id')` would return it) even though nothing changed.
      // Together these make `transitioned` non-empty only on a genuine status
      // change, for every status — not just `paid`. `select('id')` returns the
      // rows that actually changed, so the transition-gated side effects below
      // fire at-most-once under Razorpay retries (a delivery that updated but
      // crashed before marking processed) and under two concurrent deliveries
      // of the same event (both read processed=false).
      const { data: transitioned } = await supabase
        .from('deals')
        .update(update)
        .eq('id', deal.id)
        .neq('payment_status', 'paid')
        .neq('payment_status', newStatus)
        .select('id')

      // On a genuine transition (the gated update actually changed a row),
      // record a `payment` activity on the deal's timeline. Because the update
      // is now a no-op when the status is unchanged, `transitioned` is empty on
      // a retry of any status, keeping this activity at-most-once under Razorpay
      // retries and concurrent deliveries — not only for `paid`. `logActivity`
      // is itself best-effort (it swallows every error), so a logging failure
      // can never break the 200 ack.
      if (transitioned && transitioned.length > 0) {
        await logActivity('deal', deal.id, 'payment', {
          metadata: {
            status: newStatus,
            razorpay_ref: paymentRef ?? null,
          },
        })
      }

      // On a genuine transition to paid, enqueue the receipt WhatsApp. Never
      // fatal to the webhook.
      if (newStatus === 'paid' && transitioned && transitioned.length > 0) {
        // `deals.total_amount` is a `numeric` column; supabase-js serializes
        // numeric values as JSON strings to preserve precision, so coerce to a
        // real number at this boundary before it reaches `.toFixed` downstream.
        await enqueueReceipt(
          supabase,
          deal.id,
          deal.contact_id,
          deal.product_id,
          Number(deal.total_amount),
        )
      }
    }
  }

  // 4. Mark the event processed.
  await supabase
    .from('webhook_events')
    .update({ processed: true, processed_at: new Date().toISOString() })
    .eq('event_id', eventId)

  return NextResponse.json({ ok: true })
}

/**
 * Fetch the receipt recipient details and fire the AiSensy receipt.
 * All failures are swallowed — the webhook must still return 200.
 */
async function enqueueReceipt(
  supabase: ReturnType<typeof getServiceClient>,
  dealId: string,
  contactId: string | null,
  productId: string | null,
  totalAmount: number,
): Promise<void> {
  try {
    if (!contactId) return

    const { data: contact } = await supabase
      .from('contacts')
      .select('name, whatsapp_number')
      .eq('id', contactId)
      .maybeSingle()

    if (!contact?.whatsapp_number) return

    let productName = 'your enrollment'
    if (productId) {
      const { data: product } = await supabase
        .from('products')
        .select('name')
        .eq('id', productId)
        .maybeSingle()
      if (product?.name) productName = product.name
    }

    await sendReceipt({
      dealId,
      name: contact.name ?? 'there',
      whatsapp: contact.whatsapp_number,
      amount: totalAmount,
      productName,
    })
  } catch {
    // Notification failures must not affect the webhook acknowledgement.
  }
}
