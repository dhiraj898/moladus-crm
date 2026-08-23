import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getFormWithFields } from '@/features/forms/queries'
import { listProducts } from '@/features/products/actions'
import type { Product } from '@/lib/supabase/types'
import FormMetaForm from '@/features/forms/FormMetaForm'
import FieldConfigurator from '@/features/forms/FieldConfigurator'
import CopyLinkButton from '@/features/forms/CopyLinkButton'
import EmbedSnippet from '@/features/forms/EmbedSnippet'

/**
 * Form builder (spec §10 — Form builder). Edits form metadata and manages the
 * ordered field list. Server component loads the form + fields + product; the
 * client components below drive the edits.
 */
export const dynamic = 'force-dynamic'

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')

export default async function FormBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [loaded, products] = await Promise.all([
    getFormWithFields(id),
    listProducts(),
  ])

  if (!loaded) notFound()
  const { form, fields, product } = loaded

  // Picker offers active products, plus the currently-bound product even if it
  // has since been deactivated, so the selection is never silently lost.
  const activeProducts = products.filter((p) => p.active !== false)
  const pickerProducts: Product[] =
    product && !activeProducts.some((p) => p.id === product.id)
      ? [product, ...activeProducts]
      : activeProducts

  return (
    <div className="mx-auto max-w-[960px]">
      <div className="mb-8">
        <Link
          href="/admin/forms"
          className="text-sm font-medium text-dim transition-colors hover:text-text"
        >
          ← Forms
        </Link>
        <div className="mt-3 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-extrabold tracking-[-0.02em]">
            {form.name}
          </h1>
          {form.status === 'published' ? (
            <CopyLinkButton url={`${APP_URL}/f/${form.slug}`} />
          ) : null}
        </div>
        <p className="mt-1 font-mono text-sm text-dim">/f/{form.slug}</p>
      </div>

      <section className="mb-12">
        <h2 className="mb-4 text-lg font-bold tracking-[-0.01em]">Details</h2>
        <FormMetaForm mode="edit" form={form} products={pickerProducts} />
      </section>

      <section className="mb-12">
        <h2 className="mb-4 text-lg font-bold tracking-[-0.01em]">Embed</h2>
        {form.status === 'published' ? (
          <EmbedSnippet src={`${APP_URL}/f/${form.slug}`} title={form.name} />
        ) : (
          <p className="text-sm text-dim">
            Publish this form to get an embeddable iframe snippet.
          </p>
        )}
      </section>

      <section>
        <FieldConfigurator form={form} initialFields={fields} />
      </section>
    </div>
  )
}
