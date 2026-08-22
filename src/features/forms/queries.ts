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

/** A form with its ordered fields and bound product, for the builder screen. */
export interface FormWithFields {
  form: Form
  fields: FormField[]
  product: Product | null
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

  let product: Product | null = null
  if ((form as Form).product_id) {
    const { data: productRow, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('id', (form as Form).product_id as string)
      .maybeSingle()
    if (productError)
      throw new Error(`Failed to load product: ${productError.message}`)
    product = (productRow as Product | null) ?? null
  }

  return {
    form: form as Form,
    fields: (fields ?? []) as FormField[],
    product,
  }
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

  let product: Product | null = null
  if ((form as Form).product_id) {
    const { data: productRow, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('id', (form as Form).product_id as string)
      .maybeSingle()
    if (productError)
      throw new Error(`Failed to load product: ${productError.message}`)
    product = (productRow as Product | null) ?? null
  }

  return {
    form: form as Form,
    fields: (fields ?? []) as FormField[],
    product,
  }
}
