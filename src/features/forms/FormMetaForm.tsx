'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Form, Product } from '@/lib/supabase/types'
import { createForm, updateForm, type ActionResult } from './actions'
import type { FormInputRaw } from './schema'

/**
 * Create / edit the metadata for a single form (spec §4 — Forms).
 *
 * `products` is the list of ACTIVE products offered in the picker (one product
 * per form). On create the user is redirected into the field builder; on edit
 * the current screen refreshes with the saved values.
 */

type Props =
  | { mode: 'create'; form?: undefined; products: Product[] }
  | { mode: 'edit'; form: Form; products: Product[] }

const inputClass =
  'rounded-[8px] border border-line bg-surface2 px-3.5 py-2.5 text-[15px] text-text outline-none transition-colors focus:border-accent'

const labelClass =
  'text-xs font-semibold uppercase tracking-[0.12em] text-dim'

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null
  return (
    <span role="alert" className="text-xs text-red">
      {messages[0]}
    </span>
  )
}

/** Lowercase, hyphenate, strip non URL-safe characters. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default function FormMetaForm({ mode, form, products }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  const [name, setName] = useState(form?.name ?? '')
  const [slug, setSlug] = useState(form?.slug ?? '')
  const [slugEdited, setSlugEdited] = useState(mode === 'edit')
  const [productId, setProductId] = useState(form?.product_id ?? '')
  const [welcomeMessage, setWelcomeMessage] = useState(
    form?.welcome_message ?? ''
  )
  const [submitLabel, setSubmitLabel] = useState(form?.submit_label ?? 'Submit')

  function handleNameChange(value: string) {
    setName(value)
    if (!slugEdited) setSlug(slugify(value))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setFieldErrors({})

    const input: FormInputRaw = {
      name,
      slug,
      product_id: productId,
      // `status` is not part of the form input: createForm always writes a
      // draft, and updateForm preserves the stored status. Publishing is an
      // explicit action in the builder (publishForm / unpublishForm).
      welcome_message: welcomeMessage,
      submit_label: submitLabel,
    }

    startTransition(async () => {
      const result: ActionResult<Form> =
        mode === 'edit'
          ? await updateForm(form.id, input)
          : await createForm(input)

      if (!result.ok) {
        setFormError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }

      if (mode === 'create') {
        router.push(`/admin/forms/${result.data.id}`)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-[640px] flex-col gap-5">
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Name</span>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          className={inputClass}
        />
        <FieldError messages={fieldErrors.name} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Slug</span>
        <input
          type="text"
          required
          value={slug}
          onChange={(e) => {
            setSlugEdited(true)
            setSlug(e.target.value)
          }}
          placeholder="my-enrollment-form"
          className={`${inputClass} font-mono`}
        />
        <span className="text-xs text-dim">
          The public form lives at <code>/f/{slug || 'your-slug'}</code>.
        </span>
        <FieldError messages={fieldErrors.slug} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Product</span>
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          className={inputClass}
        >
          <option value="">Select a product…</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
              {product.code ? ` (${product.code})` : ''}
            </option>
          ))}
        </select>
        <span className="text-xs text-dim">
          One product per form. Only active products are listed.
        </span>
        <FieldError messages={fieldErrors.product_id} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Welcome message</span>
        <textarea
          rows={2}
          value={welcomeMessage}
          onChange={(e) => setWelcomeMessage(e.target.value)}
          placeholder="Optional intro shown at the top of the form"
          className={`${inputClass} resize-y`}
        />
        <FieldError messages={fieldErrors.welcome_message} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Submit label</span>
        <input
          type="text"
          value={submitLabel}
          onChange={(e) => setSubmitLabel(e.target.value)}
          className={inputClass}
        />
        <FieldError messages={fieldErrors.submit_label} />
      </label>

      {formError ? (
        <p role="alert" className="text-sm text-red">
          {formError}
        </p>
      ) : null}

      <div className="mt-1 flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-[8px] bg-accent px-4 py-2.5 text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending
            ? 'Saving…'
            : mode === 'edit'
              ? 'Save changes'
              : 'Create form'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/admin/forms')}
          className="rounded-[8px] border border-line px-4 py-2.5 text-[15px] font-medium text-dim transition-colors hover:text-text"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
