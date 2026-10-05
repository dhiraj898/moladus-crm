import 'server-only'
import { getServiceClient } from '@/lib/supabase/server'
import type { Form, FormField, Product } from '@/lib/supabase/types'

/**
 * Server-only data loaders for forms + fields (spec §4 — Forms, FormFields).
 *
 * These are deliberately kept OUT of the `'use server'` actions module. Next.js
 * turns every export of a `'use server'` file into a publicly-callable action
 * endpoint keyed by a stable action id; a read placed there would be invokable
 * without a session and is not covered by the `/admin/:path*` middleware. As
 * plain server functions (guarded by `import 'server-only'`) these are callable
 * only from server components / other server code, never from the client.
 */

/** A form row joined with its bound product's name, for the list screen. */
export type FormListItem = Form & {
  product: { id: string; name: string; active: boolean | null } | null
}

/** A form with its ordered fields and offered products, for the builder screen.
 * `products` is the ordered offered catalogue (via form_products); `product` is
 * kept as `products[0] ?? null` so existing single-product consumers compile. */
export interface FormWithFields {
  form: Form
  fields: FormField[]
  product: Product | null
  products: Product[]
}

/** Ordered products a form offers (via form_products); falls back to the
 * legacy forms.product_id as a single-item offering when no join rows exist. */
async function loadFormProducts(
  supabase: ReturnType<typeof getServiceClient>,
  form: Form
): Promise<Product[]> {
  const { data: links, error } = await supabase
    .from('form_products')
    .select('product_id, display_order, product:products (*)')
    .eq('form_id', form.id)
    .order('display_order', { ascending: true })
  if (error) throw new Error(`Failed to load form products: ${error.message}`)

  const rows = (links ?? []) as unknown as {
    product: Product | null
  }[]
  const products = rows.map((r) => r.product).filter((p): p is Product => !!p)
  if (products.length > 0) return products

  // Legacy back-compat: a form still using forms.product_id.
  if (form.product_id) {
    const { data: p } = await supabase
      .from('products')
      .select('*')
      .eq('id', form.product_id)
      .maybeSingle()
    if (p) return [p as Product]
  }
  return []
}

/** Fetch every form (newest first) with its bound product name. */
export async function listForms(): Promise<FormListItem[]> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('forms')
    .select('*, product:products (id, name, active)')
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to list forms: ${error.message}`)
  return (data ?? []) as unknown as FormListItem[]
}

/**
 * Fetch a PUBLISHED form by its public slug, with ordered fields and bound
 * product, for the public `/f/[slug]` page. Returns `null` for a missing or
 * draft form so the route can `notFound()`.
 *
 * Uses the service-role client server-side only (RLS is deny-all); the field
 * definitions are rendered into the SSR page, never fetched from the browser.
 */
export async function getPublishedFormBySlug(
  slug: string
): Promise<FormWithFields | null> {
  const supabase = getServiceClient()

  const { data: form, error: formError } = await supabase
    .from('forms')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle()

  if (formError) throw new Error(`Failed to load form: ${formError.message}`)
  if (!form) return null

  const { data: fields, error: fieldsError } = await supabase
    .from('form_fields')
    .select('*')
    .eq('form_id', (form as Form).id)
    .order('display_order', { ascending: true })

  if (fieldsError)
    throw new Error(`Failed to load fields: ${fieldsError.message}`)

  const products = await loadFormProducts(supabase, form as Form)
  const product = products[0] ?? null

  return {
    form: form as Form,
    fields: (fields ?? []) as FormField[],
    product,
    products,
  }
}

/**
 * The ordered product ids a form offers (via `form_products`), sorted by
 * `display_order`. Returns an empty array when the form offers nothing. This is
 * the id-only companion to {@link FormWithFields.products}, used by the builder
 * picker and the publish invariant.
 */
export async function listFormProductIds(formId: string): Promise<string[]> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('form_products')
    .select('product_id, display_order')
    .eq('form_id', formId)
    .order('display_order', { ascending: true })
  if (error) throw new Error(`Failed to load form products: ${error.message}`)
  return ((data ?? []) as { product_id: string }[]).map((r) => r.product_id)
}

/** Fetch a form with its ordered fields and bound product, or `null`. */
export async function getFormWithFields(
  id: string
): Promise<FormWithFields | null> {
  const supabase = getServiceClient()

  const { data: form, error: formError } = await supabase
    .from('forms')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (formError) throw new Error(`Failed to load form: ${formError.message}`)
  if (!form) return null

  const { data: fields, error: fieldsError } = await supabase
    .from('form_fields')
    .select('*')
    .eq('form_id', id)
    .order('display_order', { ascending: true })

  if (fieldsError)
    throw new Error(`Failed to load fields: ${fieldsError.message}`)

  const products = await loadFormProducts(supabase, form as Form)
  const product = products[0] ?? null

  return {
    form: form as Form,
    fields: (fields ?? []) as FormField[],
    product,
    products,
  }
}
