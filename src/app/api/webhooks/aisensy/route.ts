import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { getSecret } from '@/features/integrations/secrets'
import { getServiceClient } from '@/lib/supabase/server'
import { verifyAiSensySignature } from '@/features/aisensy/verify'
import { moveDealStageAsSystem } from '@/features/crm/automation/moveStage'
import type { MessageDirection } from '@/lib/supabase/types'

/** Inbound button label that advances a deal to the matching stage. */
const CALL_REQUESTED_STAGE = 'Call Requested'

/**
 * AiSensy Project-API inbound webhook (Spec 6 design §5).
 *
 * Contract (mirrors the Razorpay webhook's durable, signature-first pattern):
 *  0. Fail safe when AISENSY_WEBHOOK_SECRET is unset → 503, nothing processed.
 *  1. Verify HMAC-SHA256 `X-AiSensy-Signature` over the RAW body. Invalid → 401,
 *     nothing processed.
 *  2. Parse only after the signature is trusted. Malformed JSON → 400.
 *  3. Resolve the contact by normalized phone (null when unknown — never drop).
 *  4. Idempotent upsert into `messages` keyed on aisensy_message_id.
 *  5. Return 200. Non-duplicate storage error → 500 (AiSensy retries).
 *
 * Node runtime is required for node:crypto.
 */
export const runtime = 'nodejs'

/** Digits-only, matching src/features/messages/queries.ts normalizePhone. */
function normalizePhone(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\D/g, '') : ''
}

interface AiSensyMessageData {
  id?: string
  message_id?: string
  sender?: string
  message_type?: string
  type?: string
  body?: string
  message?: string
  text?: string
  phone_number?: string
  sent_at?: string
}

interface AiSensyWebhookBody {
  topic?: string
  data?: AiSensyMessageData
  message?: AiSensyMessageData
}

/**
 * Advance the contact's most recent open deal to the "Call Requested" stage when
 * they tap that WhatsApp button. Mirrors the Razorpay webhook: a NULL-actor
 * system move (audit row + on-enter actions), scoped to non-terminal deals so a
 * paid/refunded order is never reopened. No stage, no deal, or an already-there
 * deal → no-op.
 */
async function moveDealToCallRequested(
  supabase: ReturnType<typeof getServiceClient>,
  contactId: string,
): Promise<void> {
  const { data: stage } = await supabase
    .from('stages')
    .select('id')
    .eq('name', CALL_REQUESTED_STAGE)
    .maybeSingle()
  const stageId = (stage as { id: string } | null)?.id
  if (!stageId) return

  const { data: deal } = await supabase
    .from('deals')
    .select('id, stage_id')
    .eq('contact_id', contactId)
    .not('payment_status', 'in', '("paid","refunded","failed")')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const d = deal as { id: string; stage_id: string | null } | null
  if (!d || d.stage_id === stageId) return

  await moveDealStageAsSystem(d.id, stageId, { via: 'whatsapp', fromStageId: d.stage_id })
}

export async function POST(req: Request): Promise<Response> {
  // 0. Fail safe when the webhook secret is not configured yet (deploy-first,
  //    set-secret-after window). Resolve via getSecret (DB override, then env);
  //    when neither has it the route refuses cleanly instead of crashing.
  const secret = await getSecret('AISENSY_WEBHOOK_SECRET')
  if (!secret) {
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }

  // 1. Verify signature over the RAW body.
  const rawBody = await req.text()
  const signature = req.headers.get('x-aisensy-signature')
  if (!verifyAiSensySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  // 2. Parse only after the signature is trusted.
  let body: AiSensyWebhookBody
  try {
    body = JSON.parse(rawBody) as AiSensyWebhookBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const msg = body.data ?? body.message ?? {}
  const sender = msg.sender ?? null
  const direction: MessageDirection = sender === 'USER' ? 'inbound' : 'outbound'
  const messageBody = msg.body ?? msg.message ?? msg.text ?? null
  const phone = normalizePhone(msg.phone_number)
  const sentAt = msg.sent_at ?? null

  // Idempotency key: the provider message id, or a deterministic composite when
  // absent (mirrors the Razorpay route's event-id fallback).
  const aisensyMessageId =
    msg.id ??
    msg.message_id ??
    `${sentAt ?? 'na'}:${phone || 'na'}:${crypto
      .createHash('sha1')
      .update(messageBody ?? '')
      .digest('hex')
      .slice(0, 12)}`

  const supabase = getServiceClient()

  // 3. Resolve contact by normalized phone (deterministic first match). Never
  // fatal: on no match, store with contact_id null and keep phone_number.
  let contactId: string | null = null
  if (phone) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('whatsapp_number', msg.phone_number ?? phone)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    contactId = (contact as { id: string } | null)?.id ?? null
  }

  // 4. Idempotent upsert keyed on aisensy_message_id.
  const { error } = await supabase.from('messages').upsert(
    {
      contact_id: contactId,
      aisensy_message_id: aisensyMessageId,
      direction,
      sender,
      body: messageBody,
      message_type: msg.message_type ?? msg.type ?? null,
      phone_number: phone || null,
      raw: body,
      sent_at: sentAt,
    },
    { onConflict: 'aisensy_message_id', ignoreDuplicates: true },
  )

  if (error) {
    return NextResponse.json({ error: 'storage error' }, { status: 500 })
  }

  // 4b. A customer "Call Requested" button tap advances their open deal to the
  // matching stage. Best-effort: the message is already stored, so any failure
  // here is swallowed to protect the 200 ack (and AiSensy's retry suppression).
  if (
    direction === 'inbound' &&
    contactId &&
    messageBody?.trim().toLowerCase() === CALL_REQUESTED_STAGE.toLowerCase()
  ) {
    try {
      await moveDealToCallRequested(supabase, contactId)
    } catch {
      // Swallow: moving the deal is best-effort and must not fail the webhook.
    }
  }

  // 5. Ack.
  return NextResponse.json({ ok: true })
}
