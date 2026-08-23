import { getServiceClient } from '@/lib/supabase/server'
import type { CustomFieldDef, CustomFieldEntity } from '@/lib/supabase/types'

/**
 * Read paths for custom-field definitions (spec §5).
 *
 * All DB access goes through the server-only service-role client (RLS is
 * deny-all on `custom_field_defs`). Both return defs ordered by
 * `display_order` so the Settings editor, forms, and detail pages all render
 * fields in the same admin-defined order.
 */

/** Every def for an entity (active + inactive), ordered — for the Settings editor. */
export async function listCustomFieldDefs(
  entityType: CustomFieldEntity
): Promise<CustomFieldDef[]> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('custom_field_defs')
    .select('*')
    .eq('entity_type', entityType)
    .order('display_order', { ascending: true })
  if (error) throw new Error(`Failed to list custom fields: ${error.message}`)
  return (data ?? []) as CustomFieldDef[]
}

/** Active defs only, ordered — for entity forms + detail rendering. */
export async function getActiveCustomFieldDefs(
  entityType: CustomFieldEntity
): Promise<CustomFieldDef[]> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('custom_field_defs')
    .select('*')
    .eq('entity_type', entityType)
    .eq('active', true)
    .order('display_order', { ascending: true })
  if (error) throw new Error(`Failed to list custom fields: ${error.message}`)
  return (data ?? []) as CustomFieldDef[]
}
