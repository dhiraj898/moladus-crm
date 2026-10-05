import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  getFormWithFields,
  listFormProductIds,
} from '@/features/forms/queries'
import { listProducts } from '@/features/products/actions'
import type { Product } from '@/lib/supabase/types'
import FormMetaForm from '@/features/forms/FormMetaForm'
import FormProductsPicker from '@/features/forms/FormProductsPicker'
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
  const [loaded, products, offeredIds] = await Promise.all([
    getFormWithFields(id),
    listProducts(),
    listFormProductIds(id),
  ])

  if (!loaded) notFound()
  const { form, fields, products: offered } = loaded

  // Picker offers active products, plus any currently-offered product that has
  // since been deactivated, so the selection is never silently lost.
  const activeProducts = products.filter((p) => p.active !== false)
  const offeredInactive = offered.filter(
    (p) => p.active === false && !activeProducts.some((a) => a.id === p.id)
  )
  const pickerProducts: Product[] = [...offeredInactive, ...activeProducts]

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
        <FormMetaForm mode="edit" form={form} />
      </section>

      <section className="mb-12">
        <h2 className="mb-2 text-lg font-bold tracking-[-0.01em]">
          Products offered
        </h2>
        <p className="mb-4 max-w-[640px] text-sm text-dim">
          Choose which products and bundles this form offers. Customers pick
          from these on the public form; the order here is the order they see.
          At least one is required to publish.
        </p>
        <FormProductsPicker
          formId={form.id}
          products={pickerProducts}
          initialSelectedIds={offeredIds}
        />
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
