'use server'

import { revalidatePath } from 'next/cache'
import { getServiceClient } from '@/lib/supabase/server'
import { requirePermission } from '@/features/rbac/permissions'
import { getActiveCustomFieldDefs } from '@/features/crm/custom-fields/queries'
import {
  validateCustomFields,
  toFieldErrors,
} from '@/features/crm/custom-fields/validate'
import type { Product } from '@/lib/supabase/types'
import { productSchema, type ProductInputRaw } from './schema'

/**
 * Server actions for the product master (spec §4 — Products).
 *
 * All DB access goes through the server-only service-role client (RLS is
 * deny-all), so these actions are the only path to the `products` table. Every
 * mutating action asserts `requirePermission('products', 'edit')` first (which
 * internally calls `getCurrentUser()` — authentication — then checks the
 * `products.edit` capability — authorization); `listProducts`/`getProduct` are
 * plain reads gated by the section layout. Every write revalidates
 * `/admin/products` so the list reflects changes.
 */

/** Discriminated result returned by mutating actions. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

/** Postgres unique-violation error code. */
const UNIQUE_VIOLATION = '23505'

/** Fetch every product, newest first. */
export async function listProducts(): Promise<Product[]> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to list products: ${error.message}`)
  return (data ?? []) as Product[]
}

/** Fetch a single product by id, or `null` when it does not exist. */
export async function getProduct(id: string): Promise<Product | null> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`Failed to load product: ${error.message}`)
  return (data as Product | null) ?? null
}

/** Validate and insert a new product. */
export async function createProduct(
  input: ProductInputRaw
): Promise<ActionResult<Product>> {
  const gate = await requirePermission('products', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const parsed = productSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }
  const { custom_fields: rawCustom, ...productData } = parsed.data

  const defs = await getActiveCustomFieldDefs('product')
  const cf = validateCustomFields('product', defs, rawCustom ?? {})
  if (!cf.ok) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: toFieldErrors(cf.errors),
    }
  }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('products')
    .insert({ ...productData, custom_fields: cf.values })
    .select('*')
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: 'A product with this code already exists.',
        fieldErrors: { code: ['This code is already in use.'] },
      }
    }
    return { ok: false, error: `Failed to create product: ${error.message}` }
  }

  revalidatePath('/admin/products')
  return { ok: true, data: data as Product }
}

/** Validate and update an existing product; also bumps `updated_at`. */
export async function updateProduct(
  id: string,
  input: ProductInputRaw
): Promise<ActionResult<Product>> {
  const gate = await requirePermission('products', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const parsed = productSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }
  const { custom_fields: rawCustom, ...productData } = parsed.data

  const defs = await getActiveCustomFieldDefs('product')
  const cf = validateCustomFields('product', defs, rawCustom ?? {})
  if (!cf.ok) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: toFieldErrors(cf.errors),
    }
  }

  const supabase = getServiceClient()

  // Preserve values for inactive/deleted defs: drop the active-def keys from the
  // existing custom_fields, then spread the freshly-validated values on top.
  const { data: existing } = await supabase
    .from('products')
    .select('custom_fields')
    .eq('id', id)
    .maybeSingle()
  const activeKeys = new Set(defs.map((d) => d.key))
  const preserved = Object.fromEntries(
    Object.entries(
      (existing?.custom_fields ?? {}) as Record<string, unknown>
    ).filter(([k]) => !activeKeys.has(k))
  )
  const mergedCustom = { ...preserved, ...cf.values }

  const { data, error } = await supabase
    .from('products')
    .update({
      ...productData,
      custom_fields: mergedCustom,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: 'A product with this code already exists.',
        fieldErrors: { code: ['This code is already in use.'] },
      }
    }
    return { ok: false, error: `Failed to update product: ${error.message}` }
  }

  revalidatePath('/admin/products')
  revalidatePath(`/admin/products/${id}`)
  return { ok: true, data: data as Product }
}

/** Toggle a product's active flag (soft enable/disable). */
export async function setProductActive(
  id: string,
  active: boolean
): Promise<ActionResult<Product>> {
  const gate = await requirePermission('products', 'edit')
  if (!gate.ok) return { ok: false, error: gate.error }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('products')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    return { ok: false, error: `Failed to update product: ${error.message}` }
  }

  revalidatePath('/admin/products')
  return { ok: true, data: data as Product }
}
