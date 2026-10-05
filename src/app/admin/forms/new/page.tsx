import Link from 'next/link'
import FormMetaForm from '@/features/forms/FormMetaForm'

/**
 * Create a new form (spec §4 / §10). The form is created as a draft; products
 * offered and fields are configured on the builder page it redirects to.
 */
export const dynamic = 'force-dynamic'

export default function NewFormPage() {
  return (
    <div className="mx-auto max-w-[960px]">
      <div className="mb-8">
        <Link
          href="/admin/forms"
          className="text-sm font-medium text-dim transition-colors hover:text-text"
        >
          ← Forms
        </Link>
        <h1 className="mt-3 text-2xl font-extrabold tracking-[-0.02em]">
          New form
        </h1>
        <p className="mt-1 text-sm text-dim">
          Name the form and choose a slug. You&apos;ll add the products it
          offers and its fields next.
        </p>
      </div>

      <FormMetaForm mode="create" />
    </div>
  )
}
