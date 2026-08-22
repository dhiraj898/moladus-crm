'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Product } from '@/lib/supabase/types'
import { createProduct, updateProduct, type ActionResult } from './actions'
import type { ProductInputRaw } from './schema'

/**
 * Create / edit form for a single product (spec §4 — Products).
 *
 * One product per form. Submitting calls the matching server action and, on
 * success, returns to the list. Field-level errors from Zod are surfaced
 * inline under each control.
 */

type Props =
  | { mode: 'create'; product?: undefined }
  | { mode: 'edit'; product: Product }

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

export default function ProductForm({ mode, product }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  // Controlled state seeded from the existing product on edit.
  const [name, setName] = useState(product?.name ?? '')
  const [code, setCode] = useState(product?.code ?? '')
  const [sacCode, setSacCode] = useState(product?.sac_code ?? '')
  const [description, setDescription] = useState(product?.description ?? '')
  const [basePrice, setBasePrice] = useState(
    product ? String(product.base_price) : ''
  )
  const [currency, setCurrency] = useState(product?.currency ?? 'INR')
  const [taxable, setTaxable] = useState(product?.taxable ?? true)
  const [gstPercentage, setGstPercentage] = useState(
    product?.gst_percentage != null ? String(product.gst_percentage) : '18'
  )
  const [priceMode, setPriceMode] = useState(product?.price_mode ?? 'exclusive')
  const [active, setActive] = useState(product?.active ?? true)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setFieldErrors({})

    const input: ProductInputRaw = {
      name,
      code,
      sac_code: sacCode,
      description,
      base_price: basePrice,
      currency,
      taxable,
      gst_percentage: gstPercentage,
      price_mode: priceMode,
      active,
    }

    startTransition(async () => {
      const result: ActionResult<Product> =
        mode === 'edit'
          ? await updateProduct(product.id, input)
          : await createProduct(input)

      if (!result.ok) {
        setFormError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }

      router.push('/admin/products')
      router.refresh()
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
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
        <FieldError messages={fieldErrors.name} />
      </label>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Code</span>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Optional, unique"
            className={inputClass}
          />
          <FieldError messages={fieldErrors.code} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>SAC code</span>
          <input
            type="text"
            value={sacCode}
            onChange={(e) => setSacCode(e.target.value)}
            placeholder="Optional"
            className={inputClass}
          />
          <FieldError messages={fieldErrors.sac_code} />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Description</span>
        <textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={`${inputClass} resize-y`}
        />
        <FieldError messages={fieldErrors.description} />
      </label>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Base price</span>
          <input
            type="number"
            required
            inputMode="decimal"
            step="0.01"
            min="0"
            value={basePrice}
            onChange={(e) => setBasePrice(e.target.value)}
            className={`${inputClass} tabular-nums`}
          />
          <FieldError messages={fieldErrors.base_price} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Currency</span>
          <input
            type="text"
            required
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className={inputClass}
          />
          <FieldError messages={fieldErrors.currency} />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>GST %</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            max="100"
            value={gstPercentage}
            onChange={(e) => setGstPercentage(e.target.value)}
            disabled={!taxable}
            className={`${inputClass} tabular-nums disabled:cursor-not-allowed disabled:opacity-60`}
          />
          <FieldError messages={fieldErrors.gst_percentage} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Price mode</span>
          <select
            value={priceMode}
            onChange={(e) =>
              setPriceMode(e.target.value as 'inclusive' | 'exclusive')
            }
            className={inputClass}
          >
            <option value="exclusive">Exclusive of GST</option>
            <option value="inclusive">Inclusive of GST</option>
          </select>
          <FieldError messages={fieldErrors.price_mode} />
        </label>
      </div>

      <div className="flex flex-col gap-3 rounded-[10px] border border-line bg-surface p-4">
        <label className="flex items-center justify-between gap-4">
          <span className="flex flex-col">
            <span className="text-sm font-medium text-text">Taxable</span>
            <span className="text-xs text-dim">
              When off, GST is not applied to this product.
            </span>
          </span>
          <input
            type="checkbox"
            checked={taxable}
            onChange={(e) => setTaxable(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
        </label>

        <div className="h-px bg-line" />

        <label className="flex items-center justify-between gap-4">
          <span className="flex flex-col">
            <span className="text-sm font-medium text-text">Active</span>
            <span className="text-xs text-dim">
              Inactive products cannot be linked to new forms.
            </span>
          </span>
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
        </label>
      </div>

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
              : 'Create product'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/admin/products')}
          className="rounded-[8px] border border-line px-4 py-2.5 text-[15px] font-medium text-dim transition-colors hover:text-text"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
