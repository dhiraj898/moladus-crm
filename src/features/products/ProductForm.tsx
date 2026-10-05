'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type {
  CustomFieldDef,
  CustomFieldValues,
  Product,
} from '@/lib/supabase/types'
import { createProduct, updateProduct, type ActionResult } from './actions'
import type { ProductInputRaw } from './schema'
import { buildBundleName } from './bundle'
import CustomFieldInputs from '@/features/crm/custom-fields/CustomFieldInputs'

/**
 * Create / edit form for a single product (spec §4 — Products).
 *
 * One product per form. Submitting calls the matching server action and, on
 * success, returns to the list. Field-level errors from Zod are surfaced
 * inline under each control.
 */

type Props =
  | {
      mode: 'create'
      customFieldDefs: CustomFieldDef[]
      products: Product[]
      product?: undefined
    }
  | {
      mode: 'edit'
      customFieldDefs: CustomFieldDef[]
      products: Product[]
      product: Product
    }

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

export default function ProductForm({
  mode,
  product,
  products,
  customFieldDefs,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Other active products available as bundle components (never itself).
  const componentChoices = products.filter(
    (p) => p.active && p.id !== product?.id && !p.is_bundle
  )

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
  const [customFields, setCustomFields] = useState<CustomFieldValues>(
    product?.custom_fields ?? {}
  )

  // Bundle authoring state. Components are stored as an ordered id list; the
  // free-text tier is a naming aid only (not persisted on its own).
  const [isBundle, setIsBundle] = useState(product?.is_bundle ?? false)
  const [bundleComponents, setBundleComponents] = useState<string[]>(
    product?.bundle_components ?? []
  )
  const [tier, setTier] = useState('')

  const nameById = new Map(componentChoices.map((p) => [p.id, p.name]))

  /** Recompute the derived bundle name (and a default description) from the
   * current component selection + tier, prefilling the editable fields. */
  function applyBundleNaming(componentIds: string[], tierValue: string) {
    const names = componentIds
      .map((id) => nameById.get(id))
      .filter((n): n is string => Boolean(n))
    setName(buildBundleName(names, tierValue))
    const t = tierValue.trim()
    if (t) setDescription(t)
  }

  function toggleComponent(id: string, on: boolean) {
    const next = on
      ? [...bundleComponents, id]
      : bundleComponents.filter((c) => c !== id)
    setBundleComponents(next)
    applyBundleNaming(next, tier)
  }

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
      is_bundle: isBundle,
      bundle_components: isBundle ? bundleComponents : null,
      custom_fields: customFields,
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

        <div className="h-px bg-line" />

        <label className="flex items-center justify-between gap-4">
          <span className="flex flex-col">
            <span className="text-sm font-medium text-text">Bundle</span>
            <span className="text-xs text-dim">
              Group existing products under one sellable item.
            </span>
          </span>
          <input
            type="checkbox"
            checked={isBundle}
            onChange={(e) => {
              const on = e.target.checked
              setIsBundle(on)
              if (on) applyBundleNaming(bundleComponents, tier)
            }}
            className="h-4 w-4 accent-accent"
          />
        </label>
      </div>

      {isBundle ? (
        <div className="flex flex-col gap-4 rounded-[10px] border border-line bg-surface p-4">
          <div className="flex flex-col gap-1.5">
            <span className={labelClass}>Components</span>
            {componentChoices.length === 0 ? (
              <p className="text-xs text-dim">
                No other active products available to bundle.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {componentChoices.map((p) => (
                  <label key={p.id} className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={bundleComponents.includes(p.id)}
                      onChange={(e) => toggleComponent(p.id, e.target.checked)}
                      className="h-4 w-4 accent-accent"
                    />
                    <span className="text-sm text-text">{p.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Tier</span>
            <input
              type="text"
              value={tier}
              onChange={(e) => {
                setTier(e.target.value)
                applyBundleNaming(bundleComponents, e.target.value)
              }}
              placeholder="e.g. Pro, Elite"
              className={inputClass}
            />
            <span className="text-xs text-dim">
              Used to build the bundle name, e.g. “A+B+C - Elite”. You can still
              edit the name above.
            </span>
          </label>
        </div>
      ) : null}

      <CustomFieldInputs
        defs={customFieldDefs}
        values={customFields}
        errors={fieldErrors}
        onChange={setCustomFields}
      />

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
