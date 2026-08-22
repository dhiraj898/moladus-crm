'use server'

import { revalidatePath } from 'next/cache'
import { getServiceClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/auth'
import { getEnv } from '@/lib/env'
import { computeGST, type GSTBreakdown } from '@/features/gst/compute'
import { createPaymentLink } from '@/features/razorpay/paymentLink'
import { logActivity } from '@/features/crm/activities/service'
import type { Contact, Product } from '@/lib/supabase/types'
import {
  createDealSchema,
  updateDealSchema,
  type CreateDealInputRaw,
  type UpdateDealInputRaw,
} from './schema'

/**
 * Server actions for deals (spec §4.2 / §6 — deal stage control + manual
 * create/edit).
 *
 * All DB access goes through the server-only service-role client (RLS is
 * deny-all). Every mutating action asserts an admin session via
 * `getCurrentUser()` first and stamps the returned `user.id` as the actor on the
 * deal, its stage events, and the activity timeline — that per-action check is
 * the effective authorization boundary (see `src/lib/supabase/auth.ts`). Manual
 * sales status lives on `deals.stage_id`; `payment_status` is separate and
 * auto-managed. GST is ALWAYS recomputed from the product row via `computeGST`
 * — never accepted from the client.
 */

/** Discriminated result returned by mutating actions. */
export type ActionResult<T> =
  | { ok: true; data: T; warning?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

/** Error returned when a mutation is attempted without an admin session. */
const UNAUTHENTICATED = 'You must be signed in to do that.'

/** Postgres unique-violation SQLSTATE (the `deals_open_dedupe` index). */
const UNIQUE_VIOLATION = '23505'

/** Friendly message for the open-deal-per-(contact,product) dedupe collision. */
const OPEN_DEAL_EXISTS =
  'An open deal already exists for this contact and product.'

// ---------------------------------------------------------------------------
// Stage change
// ---------------------------------------------------------------------------

/**
 * Move a deal to a new stage. Reads the current stage (for the `from`), updates
 * `deals.stage_id` + `stage_entered_at`, appends a `deal_stage_events` row
 * stamped with the current user, and logs a `stage_change` activity carrying the
 * human-readable `{ from, to }` stage names for the timeline. The target stage
 * must exist. Revalidates the deal detail page.
 */
export async function changeDealStage(
  dealId: string,
  stageId: string
): Promise<ActionResult<void>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: UNAUTHENTICATED }

  const supabase = getServiceClient()

  // Current stage (for the `from` side of the transition).
  const { data: dealRow, error: dealError } = await supabase
    .from('deals')
    .select('stage_id')
    .eq('id', dealId)
    .maybeSingle()

  if (dealError) {
    return { ok: false, error: `Failed to change stage: ${dealError.message}` }
  }
  if (!dealRow) return { ok: false, error: 'Deal not found.' }

  const fromStageId = (dealRow as { stage_id: string | null }).stage_id

  // Resolve stage names for both ends of the transition in one query.
  const ids = Array.from(new Set([fromStageId, stageId].filter(Boolean)))
  const { data: stageRows, error: stageError } = await supabase
    .from('stages')
    .select('id, name')
    .in('id', ids as string[])

  if (stageError) {
    return { ok: false, error: `Failed to change stage: ${stageError.message}` }
  }

  const nameById = new Map<string, string>()
  for (const s of (stageRows ?? []) as { id: string; name: string }[]) {
    nameById.set(s.id, s.name)
  }

  const toName = nameById.get(stageId)
  if (!toName) return { ok: false, error: 'Stage not found.' }
  const fromName = fromStageId ? (nameById.get(fromStageId) ?? null) : null

  const now = new Date().toISOString()

  // Update the deal's manual sales status.
  const { error: updateError } = await supabase
    .from('deals')
    .update({ stage_id: stageId, stage_entered_at: now, updated_at: now })
    .eq('id', dealId)

  if (updateError) {
    return { ok: false, error: `Failed to change stage: ${updateError.message}` }
  }

  // Append the stage event (audit trail; actor = current user).
  const { error: eventError } = await supabase
    .from('deal_stage_events')
    .insert({
      deal_id: dealId,
      stage_id: stageId,
      actor_id: user.id,
      entered_at: now,
    })

  if (eventError) {
    return { ok: false, error: `Failed to change stage: ${eventError.message}` }
  }

  // Timeline entry (best-effort; never throws).
  await logActivity('deal', dealId, 'stage_change', {
    actorId: user.id,
    metadata: { from: fromName, to: toName },
  })

  revalidatePath(`/admin/deals/${dealId}`)
  return { ok: true, data: undefined }
}

// ---------------------------------------------------------------------------
// GST preview (create/edit form)
// ---------------------------------------------------------------------------

/**
 * Compute the authoritative GST breakdown for a product + place-of-supply, for
 * the manual deal form's live preview. Runs server-side so the business home
 * state (`BUSINESS_STATE`) and the product's rate stay the single source of
 * truth — the client never recomputes tax.
 */
export async function previewDealGST(
  productId: string,
  placeOfSupply: string
): Promise<ActionResult<GSTBreakdown>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: UNAUTHENTICATED }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .maybeSingle()

  if (error) return { ok: false, error: `Failed to price deal: ${error.message}` }
  if (!data) return { ok: false, error: 'Product not found.' }

  return { ok: true, data: computeGST(data as Product, placeOfSupply.trim()) }
}

// ---------------------------------------------------------------------------
// Manual create
// ---------------------------------------------------------------------------

/**
 * Manually create a deal. Resolves the product, recomputes GST from it, inserts
 * the deal at the default pipeline stage owned by the current user, records the
 * opening stage event + a `created` activity, and — when `create_payment_link`
 * is set — mints a Razorpay link for the GST-inclusive total and advances the
 * deal to `link_sent`. A link failure is non-fatal: the deal is still saved and
 * the result carries a `warning`.
 */
export async function createDeal(
  input: CreateDealInputRaw
): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: UNAUTHENTICATED }

  const parsed = createDealSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }
  const { contact_id, lead_id, product_id, place_of_supply, create_payment_link } =
    parsed.data

  const supabase = getServiceClient()

  // Resolve the product (needed for the authoritative GST computation).
  const { data: productRow, error: productError } = await supabase
    .from('products')
    .select('*')
    .eq('id', product_id)
    .maybeSingle()

  if (productError) {
    return { ok: false, error: `Failed to create deal: ${productError.message}` }
  }
  if (!productRow) return { ok: false, error: 'Product not found.' }
  const product = productRow as Product

  const gst = computeGST(product, place_of_supply)

  // Resolve the default pipeline stage (new deals enter here).
  const { data: defaultStageRow, error: stageError } = await supabase
    .from('stages')
    .select('id')
    .eq('is_default', true)
    .maybeSingle()

  if (stageError) {
    return { ok: false, error: `Failed to create deal: ${stageError.message}` }
  }
  const defaultStageId = (defaultStageRow as { id: string } | null)?.id ?? null
  if (!defaultStageId) {
    return {
      ok: false,
      error: 'No default stage is configured. Set one in Settings → Stages.',
    }
  }

  const now = new Date().toISOString()

  const { data: dealRow, error: dealError } = await supabase
    .from('deals')
    .insert({
      lead_id: lead_id ?? null,
      contact_id,
      product_id,
      base_amount: product.base_price,
      taxable_amount: gst.taxableAmount,
      cgst: gst.cgst,
      sgst: gst.sgst,
      igst: gst.igst,
      total_amount: gst.total,
      place_of_supply,
      stage_id: defaultStageId,
      stage_entered_at: now,
      owner_id: user.id,
      payment_status: 'pending',
    })
    .select('id')
    .single()

  if (dealError || !dealRow) {
    if (dealError?.code === UNIQUE_VIOLATION) {
      return { ok: false, error: OPEN_DEAL_EXISTS }
    }
    return {
      ok: false,
      error: `Failed to create deal: ${dealError?.message ?? 'unknown error'}`,
    }
  }
  const dealId = (dealRow as { id: string }).id

  // Opening stage event + created activity (audit + timeline).
  await supabase.from('deal_stage_events').insert({
    deal_id: dealId,
    stage_id: defaultStageId,
    actor_id: user.id,
    entered_at: now,
  })
  await logActivity('deal', dealId, 'created', { actorId: user.id })

  let warning: string | undefined

  if (create_payment_link) {
    warning = await tryCreatePaymentLink(supabase, dealId, product, gst.total, contact_id)
  }

  revalidatePath('/admin/deals')
  revalidatePath(`/admin/deals/${dealId}`)
  return warning
    ? { ok: true, data: { id: dealId }, warning }
    : { ok: true, data: { id: dealId } }
}

/**
 * Best-effort Razorpay link creation for a freshly-created deal. Returns a
 * warning string on failure (the deal is already saved) or `undefined` on
 * success. Resolves the contact for the customer block; a missing contact or a
 * Razorpay outage both degrade to a warning rather than failing the create.
 */
async function tryCreatePaymentLink(
  supabase: ReturnType<typeof getServiceClient>,
  dealId: string,
  product: Product,
  total: number,
  contactId: string
): Promise<string | undefined> {
  const { data: contactRow } = await supabase
    .from('contacts')
    .select('name, email, whatsapp_number')
    .eq('id', contactId)
    .maybeSingle()
  const contact = contactRow as Pick<
    Contact,
    'name' | 'email' | 'whatsapp_number'
  > | null

  if (!contact) {
    return 'Deal saved, but the payment link could not be created (contact not found).'
  }

  try {
    const env = getEnv()
    const link = await createPaymentLink({
      amountPaise: Math.round(total * 100),
      description: product.name,
      customer: {
        name: contact.name ?? 'Student',
        email: contact.email ?? undefined,
        contact: contact.whatsapp_number,
      },
      callbackUrl: `${env.NEXT_PUBLIC_APP_URL}/admin/deals/${dealId}`,
      referenceId: dealId,
      notes: { deal_id: dealId, product_id: product.id },
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

    return undefined
  } catch {
    return 'Deal saved, but the payment link could not be created. Try again from the deal page.'
  }
}

// ---------------------------------------------------------------------------
// Manual edit
// ---------------------------------------------------------------------------

/**
 * Update an existing deal's editable fields (contact, optional lead link,
 * product, place-of-supply). GST is recomputed from the resolved product + the
 * new place-of-supply so the stored breakdown stays authoritative. Logs an
 * `edited` activity. Does not touch the payment link or stage.
 */
export async function updateDeal(
  id: string,
  input: UpdateDealInputRaw
): Promise<ActionResult<void>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: UNAUTHENTICATED }

  const parsed = updateDealSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }
  const { contact_id, lead_id, product_id, place_of_supply } = parsed.data

  const supabase = getServiceClient()

  const { data: productRow, error: productError } = await supabase
    .from('products')
    .select('*')
    .eq('id', product_id)
    .maybeSingle()

  if (productError) {
    return { ok: false, error: `Failed to update deal: ${productError.message}` }
  }
  if (!productRow) return { ok: false, error: 'Product not found.' }
  const product = productRow as Product

  const gst = computeGST(product, place_of_supply)

  const { error: updateError } = await supabase
    .from('deals')
    .update({
      lead_id: lead_id ?? null,
      contact_id,
      product_id,
      base_amount: product.base_price,
      taxable_amount: gst.taxableAmount,
      cgst: gst.cgst,
      sgst: gst.sgst,
      igst: gst.igst,
      total_amount: gst.total,
      place_of_supply,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (updateError) {
    if (updateError.code === UNIQUE_VIOLATION) {
      return { ok: false, error: OPEN_DEAL_EXISTS }
    }
    return { ok: false, error: `Failed to update deal: ${updateError.message}` }
  }

  await logActivity('deal', id, 'edited', { actorId: user.id })

  revalidatePath('/admin/deals')
  revalidatePath(`/admin/deals/${id}`)
  return { ok: true, data: undefined }
}
