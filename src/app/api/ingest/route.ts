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
import { createPaymentLink } from '@/features/razorpay/paymentLink'
import { sendEnrollmentLink } from '@/features/aisensy/send'

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
 * ENV-PENDING: the end-to-end flow needs live Supabase, Razorpay, hCaptcha, and
 * AiSensy credentials. Manual test once keys exist is documented at the bottom
 * of this file.
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

interface FinalizeParams {
  dealId: string
  /** GST-inclusive total in rupees. */
  total: number
  product: { id: string; name: string }
  customerName: string
  customerEmail?: string
  whatsapp: string
  formSlug: string
  /** Display name for the WhatsApp notification. */
  notifyName: string
}

/**
 * Steps 7–9: create the Razorpay payment link for a deal, persist it, advance
 * the deal to `link_sent`, fire the enrollment WhatsApp, and return the success
 * response. On a Razorpay outage this returns a 502 WITHOUT mutating the deal,
 * so the deal stays open+unlinked and a later submission resumes it (rather than
 * bricking the contact+product on a permanent 500). Notification failure is
 * swallowed inside the sender and never fatal.
 */
async function finalizeDeal(
  supabase: ReturnType<typeof getServiceClient>,
  env: ReturnType<typeof getEnv>,
  params: FinalizeParams
): Promise<NextResponse> {
  let paymentLink: { id: string; short_url: string }
  try {
    paymentLink = await createPaymentLink({
      amountPaise: Math.round(params.total * 100),
      description: params.product.name,
      customer: {
        name: params.customerName,
        email: params.customerEmail,
        contact: params.whatsapp,
      },
      callbackUrl: `${env.NEXT_PUBLIC_APP_URL}/f/${params.formSlug}/thank-you`,
      referenceId: params.dealId,
      notes: { deal_id: params.dealId, product_id: params.product.id },
    })
  } catch {
    return fail('Could not start payment. Please try again shortly.', 502)
  }

  // Persist the link on the deal and advance to link_sent.
  await supabase
    .from('deals')
    .update({
      razorpay_payment_link_id: paymentLink.id,
      razorpay_payment_link_url: paymentLink.short_url,
      payment_status: 'link_sent',
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.dealId)

  // Fire the enrollment-link WhatsApp. Failure is logged inside the sender
  // (notification_log) and is NEVER fatal to the submission.
  await sendEnrollmentLink({
    dealId: params.dealId,
    name: params.notifyName,
    whatsapp: params.whatsapp,
    paymentLink: paymentLink.short_url,
  })

  return NextResponse.json({ success: true, payment_link: paymentLink.short_url })
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

  // 2. CAPTCHA verify (400 on fail). Only enforced when a site key is configured.
  const env = getEnv()
  if (env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY) {
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
      // Open deal exists but was never linked — resume payment for it.
      const gst = computeGST(product, boundLead.state ?? '')
      return finalizeDeal(supabase, env, {
        dealId: openDeal.id,
        total: gst.total,
        product,
        customerName: boundContact.name ?? 'Student',
        customerEmail: boundContact.email ?? undefined,
        whatsapp,
        formSlug: form.slug,
        notifyName: boundContact.name ?? 'there',
      })
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

  // 6d. Insert Deal. The partial unique index `deals_open_dedupe` guards against
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
      stage: 'new',
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
        // Deal exists but was never linked (prior Razorpay outage) — resume it
        // instead of permanently 500-ing this contact+product.
        return finalizeDeal(supabase, env, {
          dealId: openDeal.id,
          total: gst.total,
          product,
          customerName: contact.name ?? boundContact.name ?? 'Student',
          customerEmail: contact.email ?? boundContact.email ?? undefined,
          whatsapp,
          formSlug: form.slug,
          notifyName: contact.name ?? boundContact.name ?? 'there',
        })
      }
    }
    return fail('Could not create your enrollment. Please try again.', 500)
  }
  const dealId = (dealRow as Pick<Deal, 'id'>).id

  // 7–9. Create the Razorpay payment link for the GST-inclusive total, persist
  // it, advance the deal, notify, and return.
  return finalizeDeal(supabase, env, {
    dealId,
    total: gst.total,
    product,
    customerName: contact.name ?? boundContact.name ?? 'Student',
    customerEmail: contact.email ?? boundContact.email ?? undefined,
    whatsapp,
    formSlug: form.slug,
    notifyName: contact.name ?? boundContact.name ?? 'there',
  })
}

/*
 * ENV-PENDING — end-to-end manual test (needs live Supabase + Razorpay +
 * hCaptcha + AiSensy):
 *   1. Publish a form bound to a product; open `/f/<slug>`, solve the hCaptcha,
 *      and submit. Expect a redirect to the Razorpay hosted payment link.
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
