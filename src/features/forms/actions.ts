'use server'

import { revalidatePath } from 'next/cache'
import { getServiceClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/auth'
import type { Form, FormField } from '@/lib/supabase/types'
import { getFormWithFields } from './queries'
import {
  formSchema,
  fieldSchema,
  type FormInputRaw,
  type FieldInputRaw,
} from './schema'

/**
 * Server actions for form + field configuration (spec §4 — Forms, FormFields).
 *
 * All DB access goes through the server-only service-role client. RLS is
 * deny-all, so these actions are the only path to the `forms` / `form_fields`
 * tables. Every write revalidates the affected admin route(s).
 */

/** Discriminated result returned by mutating actions. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

/** Postgres unique-violation error code. */
const UNIQUE_VIOLATION = '23505'

/** Standard failure returned by a mutating action invoked without a session. */
const UNAUTHORIZED = {
  ok: false as const,
  error: 'You must be signed in to perform this action.',
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

/**
 * Validate and insert a new form.
 *
 * New forms are always created as drafts. `status` is not part of the form
 * input schema — transitions to/from `published` flow exclusively through
 * {@link publishForm} / {@link unpublishForm}, which enforce the publish
 * invariant (≥1 field + an active bound product). This closes the guard-rail
 * hole where a raw action call could otherwise create a live form with no
 * fields or no active product.
 */
export async function createForm(
  input: FormInputRaw
): Promise<ActionResult<Form>> {
  if (!(await getCurrentUser())) return UNAUTHORIZED

  const parsed = formSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('forms')
    .insert({ ...parsed.data, status: 'draft' })
    .select('*')
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: 'A form with this slug already exists.',
        fieldErrors: { slug: ['This slug is already in use.'] },
      }
    }
    return { ok: false, error: `Failed to create form: ${error.message}` }
  }

  revalidatePath('/admin/forms')
  return { ok: true, data: data as Form }
}

/**
 * Validate and update an existing form; also bumps `updated_at`. The stored
 * `status` is intentionally preserved: it is not part of the form input schema,
 * so metadata edits can never flip a form to/from `published` — only
 * {@link publishForm} / {@link unpublishForm} change status.
 */
export async function updateForm(
  id: string,
  input: FormInputRaw
): Promise<ActionResult<Form>> {
  if (!(await getCurrentUser())) return UNAUTHORIZED

  const parsed = formSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('forms')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: 'A form with this slug already exists.',
        fieldErrors: { slug: ['This slug is already in use.'] },
      }
    }
    return { ok: false, error: `Failed to update form: ${error.message}` }
  }

  revalidatePath('/admin/forms')
  revalidatePath(`/admin/forms/${id}`)
  return { ok: true, data: data as Form }
}

/**
 * Publish a form. Allowed only when the form has at least one field and an
 * active product bound (spec §5 / plan Task 5.1 Step 2).
 */
export async function publishForm(id: string): Promise<ActionResult<Form>> {
  if (!(await getCurrentUser())) return UNAUTHORIZED

  const loaded = await getFormWithFields(id)
  if (!loaded) return { ok: false, error: 'Form not found.' }

  if (loaded.fields.length < 1) {
    return {
      ok: false,
      error: 'Add at least one field before publishing.',
    }
  }
  if (!loaded.product) {
    return {
      ok: false,
      error: 'Bind a product to this form before publishing.',
    }
  }
  if (loaded.product.active === false) {
    return {
      ok: false,
      error: 'The bound product is inactive — activate it before publishing.',
    }
  }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('forms')
    .update({ status: 'published', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    return { ok: false, error: `Failed to publish form: ${error.message}` }
  }

  revalidatePath('/admin/forms')
  revalidatePath(`/admin/forms/${id}`)
  return { ok: true, data: data as Form }
}

/**
 * Revert a published form to draft. This is the only sanctioned path back to
 * `draft`, mirroring {@link publishForm} as the only path to `published`, so
 * status transitions stay funnelled through these two guarded actions.
 */
export async function unpublishForm(id: string): Promise<ActionResult<Form>> {
  if (!(await getCurrentUser())) return UNAUTHORIZED

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('forms')
    .update({ status: 'draft', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    return { ok: false, error: `Failed to unpublish form: ${error.message}` }
  }

  revalidatePath('/admin/forms')
  revalidatePath(`/admin/forms/${id}`)
  return { ok: true, data: data as Form }
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/**
 * Insert or update a field on a form. When `input.id` is present the row is
 * updated in place; otherwise a new field is appended after the current
 * highest `display_order`.
 */
export async function upsertField(
  formId: string,
  input: FieldInputRaw & { id?: string }
): Promise<ActionResult<FormField>> {
  if (!(await getCurrentUser())) return UNAUTHORIZED

  const { id, ...rest } = input
  const parsed = fieldSchema.safeParse(rest)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const supabase = getServiceClient()

  if (id) {
    const { data, error } = await supabase
      .from('form_fields')
      .update({ ...parsed.data, form_id: formId })
      .eq('id', id)
      .eq('form_id', formId)
      .select('*')
      .single()

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        return {
          ok: false,
          error: 'Another field on this form already uses this key.',
          fieldErrors: { key: ['This key is already in use.'] },
        }
      }
      return { ok: false, error: `Failed to update field: ${error.message}` }
    }

    revalidatePath(`/admin/forms/${formId}`)
    return { ok: true, data: data as FormField }
  }

  // New field: append after the current max display_order.
  const { data: last, error: lastError } = await supabase
    .from('form_fields')
    .select('display_order')
    .eq('form_id', formId)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lastError)
    return { ok: false, error: `Failed to add field: ${lastError.message}` }

  const nextOrder =
    last && typeof (last as { display_order: number }).display_order === 'number'
      ? (last as { display_order: number }).display_order + 1
      : 0

  const { data, error } = await supabase
    .from('form_fields')
    .insert({ ...parsed.data, form_id: formId, display_order: nextOrder })
    .select('*')
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: 'Another field on this form already uses this key.',
        fieldErrors: { key: ['This key is already in use.'] },
      }
    }
    return { ok: false, error: `Failed to add field: ${error.message}` }
  }

  revalidatePath(`/admin/forms/${formId}`)
  return { ok: true, data: data as FormField }
}

/** Delete a field by id. Returns the parent form id for revalidation. */
export async function deleteField(
  id: string
): Promise<ActionResult<{ id: string; form_id: string | null }>> {
  if (!(await getCurrentUser())) return UNAUTHORIZED

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('form_fields')
    .delete()
    .eq('id', id)
    .select('id, form_id')
    .single()

  if (error) {
    return { ok: false, error: `Failed to delete field: ${error.message}` }
  }

  const row = data as { id: string; form_id: string | null }
  if (row.form_id) revalidatePath(`/admin/forms/${row.form_id}`)
  return { ok: true, data: row }
}

/**
 * Persist a new field order. `orderedIds` is the full list of field ids in the
 * desired order; each row's `display_order` is set to its index.
 *
 * The reindex runs inside a single Postgres function (see migration
 * 0002_reorder_form_fields.sql) so every row moves in one transaction: a
 * mid-flight failure rolls the whole reorder back rather than leaving a
 * duplicated/inconsistent `display_order` set that would diverge from the
 * client's optimistic (or rolled-back) state.
 */
export async function reorderFields(
  formId: string,
  orderedIds: string[]
): Promise<ActionResult<{ count: number }>> {
  if (!(await getCurrentUser())) return UNAUTHORIZED

  const supabase = getServiceClient()

  const { error } = await supabase.rpc('reorder_form_fields', {
    p_form_id: formId,
    p_ordered_ids: orderedIds,
  })

  if (error) {
    return {
      ok: false,
      error: `Failed to reorder fields: ${error.message}`,
    }
  }

  revalidatePath(`/admin/forms/${formId}`)
  return { ok: true, data: { count: orderedIds.length } }
}
