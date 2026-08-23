import { NextResponse } from 'next/server'
import type { AnswersMap } from '@/features/form-engine/visibility'
import type { Contact, Deal, Json, Lead } from '@/lib/supabase/types'
import { getEnv } from '@/lib/env'
import { getServiceClient } from '@/lib/supabase/server'
import { getFormWithFields } from '@/features/forms/queries'
import { applyBindings, validateAnswers } from '@/features/ingest/bind'
import { checkRateLimit } from '@/features/ingest/rateLimit'
import { verifyCaptcha } from '@/features/ingest/captcha'
import { computeGST } from '@/features/gst/compute'
import { resolveEntryStage } from '@/features/crm/automation/entry'
import { runStageActions } from '@/features/crm/automation/runActions'
import { logActivity } from '@/features/crm/activities/service'
import { assignNext } from '@/features/rbac/assignment'

/**
 * Public submission pipeline (spec §6, steps 1–14).
 *
 * `POST /api/ingest` accepts `{ form_id, answers, captcha_token }` (optionally
 * `utm`) from the public FormRunner and drives the full enrollment flow:
 * rate limit → captcha → server-side visibility + validation → bind → dedupe →
 * persist (contact/lead/deal + GST) → Razorpay payment link → AiSensy WhatsApp
 * → `{ success, payment_link }`.
 *
 * Security posture: everything the browser sent is untrusted. Field definitions,
 * visibility, validation, GST, and pricing are all recomputed server-side from
 * the stored form + product; the client's answers are treated as raw input only.
 * Supabase is reached exclusively via the service-role client (RLS deny-all),
 * and all secrets stay server-side.
 *
 * Node runtime is required: the Razorpay SDK + downstream `node:crypto` are not
 * edge-compatible.
 *
 * ENV-PENDING: the end-to-end flow needs live Supabase, Razorpay, Altcha
 * (`ALTCHA_HMAC_KEY` + `NEXT_PUBLIC_CAPTCHA_ENABLED=true`), and AiSensy
 * credentials. Manual test once keys exist is documented at the bottom of this
 * file.
 */
export const runtime = 'nodejs'

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505'

interface IngestBody {
  form_id?: unknown
  answers?: unknown
  captcha_token?: unknown
  utm?: unknown
}

/**
 * Client IP for rate limiting, derived from the TRUSTED proxy hop.
 *
 * `X-Forwarded-For` is a comma-separated chain `client, proxy1, proxy2, …`
 * where the leftmost entry is fully client-controlled (spoofable) and each
 * proxy APPENDS the peer address it actually saw. Railway's edge proxy appends
 * the real client address as the LAST entry, so we read the rightmost value —
 * using the leftmost would let anyone bypass the per-IP limiter by sending a
 * rotating `X-Forwarded-For` header. `x-real-ip` (set by the proxy) is the
 * fallback.
 */
function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const hops = xff
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean)
    const trusted = hops[hops.length - 1]
    if (trusted) return trusted
  }
  return req.headers.get('x-real-ip') ?? 'unknown'
}

/** JSON error helper. */
function fail(error: string, status: number): NextResponse {
  return NextResponse.json({ success: false, error }, { status })
}

/**
 * Run the routed stage's on-enter actions for a deal, then return the success
 * response. The payment link (if the entry stage has a `create_payment_link`
 * on-enter action, e.g. the seeded "Payment Link Sent" stage) is minted inside
 * `runStageActions`; we re-read it off the deal afterwards to hand back to the
 * FormRunner. `payment_link` is `null` when the entry stage minted no link —
 * either the entry stage has no `create_payment_link` action, or it has one that
 * failed (e.g. a Razorpay outage; `runStageActions` is best-effort and never
 * throws, so the deal is left open+unlinked and resumable by a later
 * submission). The FormRunner (`src/app/f/[slug]/FormRunner.tsx`) distinguishes
 * success-with-null-link from failure: a `{success:true, payment_link:null}`
 * response renders a "we'll be in touch on WhatsApp" confirmation panel rather
 * than the payment redirect, so a link-less entry route (e.g. "Call Requested")
 * is supported end-to-end.
 */
async function runActionsAndRespond(
  supabase: ReturnType<typeof getServiceClient>,
  dealId: string,
  stageId: string
): Promise<NextResponse> {
  await runStageActions(dealId, stageId)

  const { data } = await supabase
    .from('deals')
    .select('razorpay_payment_link_url')
    .eq('id', dealId)
    .maybeSingle()
  const url =
    (data as Pick<Deal, 'razorpay_payment_link_url'> | null)
      ?.razorpay_payment_link_url ?? null

  return NextResponse.json({ success: true, payment_link: url })
}

/**
 * Resume an existing OPEN deal that has no payment link yet (a prior attempt
 * created the deal but its on-enter link action never landed — e.g. a Razorpay
 * outage). Re-routes it via the current answers and re-runs the stage's on-enter
 * actions; `create_payment_link` is idempotent, so it mints the missing link
 * without double-charging an already-linked deal.
 *
 * The stage entry is re-stamped ONLY when the resolved stage actually differs
 * from the deal's current stage. Re-stamping `stage_entered_at` on an unchanged
 * stage would reset the SLA at-most-once dedup key (which keys on
 * `(deal, rule, stage_entered_at)`), letting a reminder fire again, and would
 * add a duplicate same-stage audit row — so a same-stage resume just re-runs the
 * on-enter actions.
 */
async function resumeOpenDeal(
  supabase: ReturnType<typeof getServiceClient>,
  dealId: string,
  answers: AnswersMap
): Promise<NextResponse> {
  const stageId = await resolveEntryStage(answers)

  const { data: dealRow } = await supabase
    .from('deals')
    .select('stage_id')
    .eq('id', dealId)
    .maybeSingle()
  const currentStageId =
    (dealRow as Pick<Deal, 'stage_id'> | null)?.stage_id ?? null

  if (currentStageId !== stageId) {
    const now = new Date().toISOString()
    await supabase
      .from('deals')
      .update({ stage_id: stageId, stage_entered_at: now, updated_at: now })
      .eq('id', dealId)
    await supabase.from('deal_stage_events').insert({
      deal_id: dealId,
      stage_id: stageId,
      actor_id: null,
      entered_at: now,
    })
  }

  return runActionsAndRespond(supabase, dealId, stageId)
}

interface OpenDeal {
  id: string
  url: string | null
}

/**
 * Look up an existing OPEN deal (not in a terminal payment state) for a
 * contact + product. Returns its id and payment-link URL (which may be `null`
 * when a prior attempt created the deal but never got a link), or `null` when
 * no open deal exists.
 */
async function findOpenDeal(
  supabase: ReturnType<typeof getServiceClient>,
  contactId: string,
  productId: string
): Promise<OpenDeal | null> {
  const { data } = await supabase
    .from('deals')
    .select('id, razorpay_payment_link_url, payment_status')
    .eq('contact_id', contactId)
    .eq('product_id', productId)
    .not('payment_status', 'in', '("paid","refunded","failed")')
    .maybeSingle()

  const deal = data as Pick<Deal, 'id' | 'razorpay_payment_link_url'> | null
  if (!deal) return null
  return { id: deal.id, url: deal.razorpay_payment_link_url ?? null }
}

export async function POST(req: Request): Promise<Response> {
  // 1. Rate limit (5/min per IP).
  const ip = clientIp(req)
  if (!checkRateLimit(ip)) {
    return fail('Too many requests. Please wait a minute and try again.', 429)
  }

  // Parse body (Step 1: parse form_id + answers + captcha_token).
  let body: IngestBody
  try {
    body = (await req.json()) as IngestBody
  } catch {
    return fail('Invalid request body.', 400)
  }

  const formId = typeof body.form_id === 'string' ? body.form_id : null
  const captchaToken = typeof body.captcha_token === 'string' ? body.captcha_token : null
  const answers: AnswersMap =
    body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)
      ? (body.answers as AnswersMap)
      : {}
  const utm: Json =
    body.utm && typeof body.utm === 'object' && !Array.isArray(body.utm)
      ? (body.utm as Json)
      : {}

  if (!formId) {
    return fail('Missing form_id.', 400)
  }

  // 2. CAPTCHA verify (400 on fail). Only enforced when CAPTCHA is enabled.
  const env = getEnv()
  if (env.NEXT_PUBLIC_CAPTCHA_ENABLED === 'true') {
    const captchaOk = await verifyCaptcha(captchaToken)
    if (!captchaOk) {
      return fail('Captcha verification failed. Please try again.', 400)
    }
  }

  // 3. Load form + fields + product; validate.
  const loaded = await getFormWithFields(formId)
  if (!loaded || loaded.form.status !== 'published') {
    return fail('This form is not available.', 404)
  }
  const { form, fields, product } = loaded

  // One product per form (locked default): a deal requires a bound product.
  if (!product) {
    return fail('This form is not configured for enrollment.', 400)
  }

  const validation = validateAnswers(fields, answers)
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: 'Please complete all required fields.', errors: validation.errors },
      { status: 400 }
    )
  }

  // 4. Bind answers → contact / lead / store-only.
  const { contact: boundContact, lead: boundLead, storeOnly } = applyBindings(fields, answers)

  const whatsapp = boundContact.whatsapp_number
  if (!whatsapp) {
    return fail('A WhatsApp number is required to enroll.', 400)
  }

  const supabase = getServiceClient()

  // 5. Idempotency: an existing OPEN deal for this contact + product returns its
  // existing payment link instead of creating a duplicate. If the open deal has
  // NO link yet (a prior Razorpay outage created the deal but never linked it),
  // resume it: create the link against the existing deal rather than 500-ing on
  // the deal-dedupe unique index below.
  const { data: existingContactRow } = await supabase
    .from('contacts')
    .select('id')
    .eq('whatsapp_number', whatsapp)
    .maybeSingle()
  const existingContact = existingContactRow as Pick<Contact, 'id'> | null

  if (existingContact) {
    const openDeal = await findOpenDeal(supabase, existingContact.id, product.id)
    if (openDeal?.url) {
      return NextResponse.json({ success: true, payment_link: openDeal.url })
    }
    if (openDeal) {
      // Open deal exists but was never linked — resume its on-enter actions.
      return resumeOpenDeal(supabase, openDeal.id, answers)
    }
  }

  // 6. Create records.
  // 6a. Insert Lead first (Contact.lead_id references it; the FK is satisfied by
  // creating the lead before linking the contact).
  const { data: leadRow, error: leadError } = await supabase
    .from('leads')
    .insert({
      form_id: form.id,
      product_id: product.id,
      name: boundContact.name ?? null,
      email: boundContact.email ?? null,
      phone: whatsapp,
      state: boundLead.state ?? null,
      source: boundLead.source ?? null,
      utm,
      raw_payload: { answers: answers as Json, store_only: storeOnly as Json },
      status: 'new',
    })
    .select('id')
    .single()

  if (leadError || !leadRow) {
    return fail('Could not record your submission. Please try again.', 500)
  }
  const leadId = (leadRow as Pick<Lead, 'id'>).id

  // 6b. Upsert Contact by whatsapp_number. Consent + timestamp are written ONLY
  // when marketing_consent is true, so a later non-consenting submission never
  // downgrades an existing opt-in (omitted columns are left untouched on
  // conflict update).
  const contactPayload: Record<string, unknown> = {
    lead_id: leadId,
    whatsapp_number: whatsapp,
  }
  if (boundContact.name !== undefined) contactPayload.name = boundContact.name
  if (boundContact.email !== undefined) contactPayload.email = boundContact.email
  if (boundContact.marketing_consent === true) {
    contactPayload.marketing_consent = true
    contactPayload.consent_timestamp = new Date().toISOString()
  }

  const { data: contactRow, error: contactError } = await supabase
    .from('contacts')
    .upsert(contactPayload, { onConflict: 'whatsapp_number' })
    .select('id, name, email, whatsapp_number')
    .single()

  if (contactError || !contactRow) {
    return fail('Could not record your contact details. Please try again.', 500)
  }
  const contact = contactRow as Pick<Contact, 'id' | 'name' | 'email' | 'whatsapp_number'>

  // 6c. Compute GST (authoritative, from the product row + customer state).
  const customerState = boundLead.state ?? ''
  const gst = computeGST(product, customerState)

  // 6d. Resolve the ENTRY stage from the submission's answers via the
  // configured entry rules (falling back to `stages.is_default` when no rule
  // matches). `deals.stage_id` is nullable with no DB default, so it must be set
  // explicitly here. The seeded default rule routes to "Payment Link Sent",
  // whose on-enter actions (create link + WhatsApp) reproduce v1 behaviour.
  const stageId = await resolveEntryStage(answers)
  const now = new Date().toISOString()

  // 6e. Insert Deal. The partial unique index `deals_open_dedupe` guards against
  // a race: two concurrent submissions can both pass the step-5 check, but only
  // one open deal per (contact, product) can exist — the loser catches the
  // unique violation and returns the winner's link.
  const { data: dealRow, error: dealError } = await supabase
    .from('deals')
    .insert({
      lead_id: leadId,
      contact_id: contact.id,
      product_id: product.id,
      base_amount: product.base_price,
      taxable_amount: gst.taxableAmount,
      cgst: gst.cgst,
      sgst: gst.sgst,
      igst: gst.igst,
      total_amount: gst.total,
      place_of_supply: boundLead.state ?? null,
      stage_id: stageId,
      stage_entered_at: now,
      payment_status: 'pending',
    })
    .select('id')
    .single()

  if (dealError || !dealRow) {
    if (dealError?.code === UNIQUE_VIOLATION) {
      // Race lost OR a prior attempt left a stuck open deal: an open deal
      // already exists for this contact + product.
      const openDeal = await findOpenDeal(supabase, contact.id, product.id)
      if (openDeal?.url) {
        // Winner already linked it — return that link.
        return NextResponse.json({ success: true, payment_link: openDeal.url })
      }
      if (openDeal) {
        // Deal exists but was never linked (prior outage) — resume its on-enter
        // actions instead of permanently 500-ing this contact+product.
        return resumeOpenDeal(supabase, openDeal.id, answers)
      }
    }
    return fail('Could not create your enrollment. Please try again.', 500)
  }
  const dealId = (dealRow as Pick<Deal, 'id'>).id

  // 6f. Opening stage event (audit trail; system actor) + `created` timeline
  // entry, mirroring the manual create-deal path.
  await supabase.from('deal_stage_events').insert({
    deal_id: dealId,
    stage_id: stageId,
    actor_id: null,
    entered_at: now,
  })
  await logActivity('deal', dealId, 'created')

  // 6g. Auto-assign this submission's lead + deal to the next agent in the pool
  // (round-robin). Best-effort: a null (empty pool) leaves owner_id null, and any
  // failure never blocks enrollment. Same agent for the lead and the deal. Only
  // this fresh-record path assigns — the resume/idempotency paths
  // (findOpenDeal/resumeOpenDeal) never reassign an existing deal.
  const assignee = await assignNext()
  if (assignee) {
    await supabase.from('leads').update({ owner_id: assignee }).eq('id', leadId)
    await supabase.from('deals').update({ owner_id: assignee }).eq('id', dealId)
  }

  // 7–9. Run the entry stage's on-enter actions (which, for the seeded Payment
  // Link Sent stage, mint the Razorpay link + send the enrollment WhatsApp),
  // then return the payment link (or null when the route has no link action).
  return runActionsAndRespond(supabase, dealId, stageId)
}

/*
 * ENV-PENDING — end-to-end manual test (needs live Supabase + Razorpay +
 * Altcha + AiSensy):
 *   1. Publish a form bound to a product; open `/f/<slug>`, let the Altcha
 *      widget solve, and submit. Expect a redirect to the Razorpay hosted
 *      payment link.
 *   2. In Supabase: a `leads` row (with raw_payload/utm/state/product_id), a
 *      `contacts` row (consent + consent_timestamp set iff the consent field was
 *      "yes"), and a `deals` row with payment_status='link_sent' and both
 *      razorpay_payment_link_id + _url populated, GST split matching §7.
 *   3. A `notification_log` row for template 'enrollment_link'.
 *   4. Resubmit the same WhatsApp + product before paying → the SAME payment
 *      link is returned (idempotency), no duplicate deal.
 *   5. Omit/tamper the captcha token → 400; exceed 5 submits/min from one IP →
 *      429.
 */
