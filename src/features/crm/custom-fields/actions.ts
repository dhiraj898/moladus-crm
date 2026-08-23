'use server'

import { revalidatePath } from 'next/cache'
import { getServiceClient } from '@/lib/supabase/server'
import { requirePermission } from '@/features/rbac/permissions'
import type { CustomFieldDef, CustomFieldEntity } from '@/lib/supabase/types'
import { customFieldDefSchema, type CustomFieldDefInputRaw } from './schema'

/**
 * Server actions for custom-field definition config (spec §5 — Custom Fields).
 *
 * Custom-field configuration lives under Settings, so every mutating action
 * asserts `requirePermission('settings', 'edit')` first (which internally calls
 * `getCurrentUser()` — authentication — then checks the `settings.edit`
 * capability — authorization). All DB access goes through the server-only
 * service-role client (RLS is deny-all), so these actions are the effective
 * authorization boundary. Each write revalidates the Custom Fields editor path.
 *
 * `entity_type` and `key` are create-only: an update never touches them.
 */

const CUSTOM_FIELDS_PATH = '/admin/settings/custom-fields'

/** Postgres unique-violation SQLSTATE — a duplicate (entity_type, key). */
const UNIQUE_VIOLATION = '23505'

/** Discriminated result returned by mutating actions. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

/**
 * Validate and insert a new custom-field definition. Appended to the end of the
 * entity's field list (`display_order` = current max for that entity + 1) and
 * active by default. A duplicate `(entity_type, key)` surfaces as a `key`
 * field error rather than a raw DB message.
 */
export async function createCustomFieldDef(
  input: CustomFieldDefInputRaw
): Promise<ActionResult<CustomFieldDef>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const parsed = customFieldDefSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const supabase = getServiceClient()

  // Next display_order = current max for this entity + 1 (1-based).
  const { data: last, error: maxError } = await supabase
    .from('custom_field_defs')
    .select('display_order')
    .eq('entity_type', parsed.data.entity_type)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (maxError) {
    return {
      ok: false,
      error: `Failed to create custom field: ${maxError.message}`,
    }
  }

  const nextOrder = (last?.display_order ?? 0) + 1

  const { data, error } = await supabase
    .from('custom_field_defs')
    .insert({
      entity_type: parsed.data.entity_type,
      key: parsed.data.key,
      label: parsed.data.label,
      field_type: parsed.data.field_type,
      required: parsed.data.required,
      options: parsed.data.options,
      display_order: nextOrder,
      active: true,
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: 'Please correct the highlighted fields.',
        fieldErrors: { key: ['This key is already in use for this entity.'] },
      }
    }
    return { ok: false, error: `Failed to create custom field: ${error.message}` }
  }

  revalidatePath(CUSTOM_FIELDS_PATH)
  return { ok: true, data: data as CustomFieldDef }
}

/**
 * Validate and update an existing definition's `label`, `field_type`,
 * `required`, and `options`; bumps `updated_at`. `entity_type` and `key` are
 * never changed (they are create-only identity).
 */
export async function updateCustomFieldDef(
  id: string,
  input: CustomFieldDefInputRaw
): Promise<ActionResult<CustomFieldDef>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const parsed = customFieldDefSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('custom_field_defs')
    .update({
      label: parsed.data.label,
      field_type: parsed.data.field_type,
      required: parsed.data.required,
      options: parsed.data.options,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: 'Please correct the highlighted fields.',
        fieldErrors: { key: ['This key is already in use for this entity.'] },
      }
    }
    return { ok: false, error: `Failed to update custom field: ${error.message}` }
  }

  revalidatePath(CUSTOM_FIELDS_PATH)
  return { ok: true, data: data as CustomFieldDef }
}

/**
 * Persist a new field order for one entity. Each id's position in `orderedIds`
 * becomes its `display_order` (1-based). Applied sequentially and scoped by
 * both id and `entity_type`; a failure aborts and reports the first error
 * (partial reorder is additive and self-correcting on retry).
 */
export async function reorderCustomFieldDefs(
  entityType: CustomFieldEntity,
  orderedIds: string[]
): Promise<ActionResult<void>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const supabase = getServiceClient()
  const now = new Date().toISOString()

  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from('custom_field_defs')
      .update({ display_order: i + 1, updated_at: now })
      .eq('id', orderedIds[i])
      .eq('entity_type', entityType)

    if (error) {
      return {
        ok: false,
        error: `Failed to reorder custom fields: ${error.message}`,
      }
    }
  }

  revalidatePath(CUSTOM_FIELDS_PATH)
  return { ok: true, data: undefined }
}

/**
 * Toggle a definition's `active` flag. Deactivating hides the field from forms
 * and detail without deleting stored values — the reversible alternative to
 * delete. Bumps `updated_at`.
 */
export async function setCustomFieldDefActive(
  id: string,
  active: boolean
): Promise<ActionResult<CustomFieldDef>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('custom_field_defs')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    return {
      ok: false,
      error: `Failed to update custom field: ${error.message}`,
    }
  }

  revalidatePath(CUSTOM_FIELDS_PATH)
  return { ok: true, data: data as CustomFieldDef }
}

/**
 * Hard-delete a definition. Stored values in each entity's `custom_fields`
 * JSONB are NOT scrubbed — orphaned keys simply stop rendering (spec §8.3).
 * Deactivating (`setCustomFieldDefActive`) is the reversible alternative.
 */
export async function deleteCustomFieldDef(
  id: string
): Promise<ActionResult<void>> {
  const gate = await requirePermission('settings', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const supabase = getServiceClient()
  const { error } = await supabase
    .from('custom_field_defs')
    .delete()
    .eq('id', id)

  if (error) {
    return { ok: false, error: `Failed to delete custom field: ${error.message}` }
  }

  revalidatePath(CUSTOM_FIELDS_PATH)
  return { ok: true, data: undefined }
}
