import 'server-only'
import { getRazorpayClient } from './client'

/**
 * Razorpay payment-link creation (spec §8).
 *
 * Amounts are handled in paise (the smallest currency unit): rupees × 100 as an
 * integer. Callers compute the rupee total (GST-inclusive) and pass it here as
 * `amountPaise`; we `Math.round` defensively so a float never leaks to the API.
 */

export interface PaymentLinkCustomer {
  name: string
  /** Optional — Razorpay accepts a link without an email. */
  email?: string
  /** WhatsApp / phone number in the customer's country format. */
  contact: string
}

export interface CreatePaymentLinkParams {
  /** Amount in paise (rupees × 100). Rounded to an integer before sending. */
  amountPaise: number
  description: string
  customer: PaymentLinkCustomer
  /** Where Razorpay redirects the payer after payment (callback_method = get). */
  callbackUrl: string
  /** Optional idempotency/reference key (e.g. the deal id). */
  referenceId?: string
  /** Optional key-value metadata stored on the link. */
  notes?: Record<string, string | number>
}

export interface PaymentLinkResult {
  id: string
  short_url: string
}

/**
 * Create a Razorpay payment link and return its id + short URL.
 *
 * ENV-PENDING: a real network call requires live RAZORPAY_KEY_ID/SECRET.
 */
export async function createPaymentLink(
  params: CreatePaymentLinkParams,
): Promise<PaymentLinkResult> {
  const client = getRazorpayClient()

  const link = await client.paymentLink.create({
    amount: Math.round(params.amountPaise),
    currency: 'INR',
    description: params.description,
    customer: {
      name: params.customer.name,
      email: params.customer.email,
      contact: params.customer.contact,
    },
    callback_url: params.callbackUrl,
    callback_method: 'get',
    ...(params.referenceId ? { reference_id: params.referenceId } : {}),
    ...(params.notes ? { notes: params.notes } : {}),
  })

  return { id: link.id, short_url: link.short_url }
}
