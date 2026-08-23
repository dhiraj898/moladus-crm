'use server'

import { revalidatePath } from 'next/cache'
import { getServiceClient } from '@/lib/supabase/server'
import { requirePermission } from '@/features/rbac/permissions'
import { logActivity } from '@/features/crm/activities/service'
import { getActiveCustomFieldDefs } from '@/features/crm/custom-fields/queries'
import {
  validateCustomFields,
  toFieldErrors,
} from '@/features/crm/custom-fields/validate'
import { contactSchema, type ContactInputRaw } from './schema'

/**
 * Server actions for contacts (spec §6 — Contact detail + manual create/edit).
 *
 * All DB access goes through the server-only service-role client (RLS is
 * deny-all). Every mutating action asserts `requirePermission('contacts',
 * 'edit')` first (which internally calls `getCurrentUser()` — authentication —
 * then checks the `contacts.edit` capability — authorization) and stamps
 * `ctx.user.id` as the actor on the activity timeline. Contacts are a plain
 * (unscoped) module, so there is no per-record ownership re-check.
 *
 * `whatsapp_number` is unique in the DB; a collision surfaces as a friendly
 * message rather than a raw Postgres error.
 */

/** Discriminated result returned by mutating actions. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

/** Postgres unique-violation SQLSTATE (the `contacts.whatsapp_number` index). */
const UNIQUE_VIOLATION = '23505'

/** Friendly message for a duplicate WhatsApp number. */
const WHATSAPP_EXISTS =
  'A contact with this WhatsApp number already exists.'

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Manually create a contact. Validates the input, sets `consent_timestamp` when
 * marketing consent is granted, inserts the row, logs a `created` activity, and
 * returns the new id. A duplicate `whatsapp_number` maps to a field-level error.
 */
export async function createContact(
  input: ContactInputRaw
): Promise<ActionResult<{ id: string }>> {
  const gate = await requirePermission('contacts', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }
  const { ctx } = gate

  const parsed = contactSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }
  const { name, email, whatsapp_number, marketing_consent, lead_id, tags } =
    parsed.data

  const defs = await getActiveCustomFieldDefs('contact')
  const cf = validateCustomFields(
    'contact',
    defs,
    parsed.data.custom_fields ?? {}
  )
  if (!cf.ok) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: toFieldErrors(cf.errors),
    }
  }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('contacts')
    .insert({
      name: name ?? null,
      email: email ?? null,
      whatsapp_number,
      marketing_consent,
      consent_timestamp: marketing_consent ? new Date().toISOString() : null,
      lead_id: lead_id ?? null,
      tags,
      custom_fields: cf.values,
    })
    .select('id')
    .single()

  if (error || !data) {
    if (error?.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: WHATSAPP_EXISTS,
        fieldErrors: { whatsapp_number: [WHATSAPP_EXISTS] },
      }
    }
    return {
      ok: false,
      error: `Failed to create contact: ${error?.message ?? 'unknown error'}`,
    }
  }
  const id = (data as { id: string }).id

  await logActivity('contact', id, 'created', { actorId: ctx.user.id })

  revalidatePath('/admin/contacts')
  revalidatePath(`/admin/contacts/${id}`)
  return { ok: true, data: { id } }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Update an existing contact's editable fields. Preserves the original
 * `consent_timestamp` when consent stays granted, stamps it the moment consent
 * is first granted, and clears it when consent is withdrawn. Logs an `edited`
 * activity. A duplicate `whatsapp_number` maps to a field-level error.
 */
export async function updateContact(
  id: string,
  input: ContactInputRaw
): Promise<ActionResult<void>> {
  const gate = await requirePermission('contacts', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }
  const { ctx } = gate

  const parsed = contactSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }
  const { name, email, whatsapp_number, marketing_consent, lead_id, tags } =
    parsed.data

  const defs = await getActiveCustomFieldDefs('contact')
  const cf = validateCustomFields(
    'contact',
    defs,
    parsed.data.custom_fields ?? {}
  )
  if (!cf.ok) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: toFieldErrors(cf.errors),
    }
  }

  const supabase = getServiceClient()

  // Resolve the current consent state so we only stamp a timestamp on the
  // transition into consent and preserve the original grant time otherwise.
  const { data: existing } = await supabase
    .from('contacts')
    .select('marketing_consent, consent_timestamp, custom_fields')
    .eq('id', id)
    .maybeSingle()
  const prior = existing as {
    marketing_consent: boolean | null
    consent_timestamp: string | null
    custom_fields: Record<string, unknown> | null
  } | null

  // Preserve values for inactive/deleted defs: drop the active-def keys from the
  // existing custom_fields, then spread the freshly-validated values on top.
  const activeKeys = new Set(defs.map((d) => d.key))
  const preserved = Object.fromEntries(
    Object.entries(prior?.custom_fields ?? {}).filter(
      ([k]) => !activeKeys.has(k)
    )
  )
  const mergedCustom = { ...preserved, ...cf.values }

  let consentTimestamp: string | null
  if (!marketing_consent) {
    consentTimestamp = null
  } else if (prior?.marketing_consent && prior.consent_timestamp) {
    consentTimestamp = prior.consent_timestamp
  } else {
    consentTimestamp = new Date().toISOString()
  }

  const { error } = await supabase
    .from('contacts')
    .update({
      name: name ?? null,
      email: email ?? null,
      whatsapp_number,
      marketing_consent,
      consent_timestamp: consentTimestamp,
      lead_id: lead_id ?? null,
      tags,
      custom_fields: mergedCustom,
    })
    .eq('id', id)

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: WHATSAPP_EXISTS,
        fieldErrors: { whatsapp_number: [WHATSAPP_EXISTS] },
      }
    }
    return { ok: false, error: `Failed to update contact: ${error.message}` }
  }

  await logActivity('contact', id, 'edited', { actorId: ctx.user.id })

  revalidatePath('/admin/contacts')
  revalidatePath(`/admin/contacts/${id}`)
  return { ok: true, data: undefined }
}
