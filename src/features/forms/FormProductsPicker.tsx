'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Product } from '@/lib/supabase/types'
import { setFormProducts, type ActionResult } from './actions'

/**
 * "Products offered" picker for the form builder (spec §4 — multi-product
 * forms). An orderable multi-select over active products: the admin adds
 * products to the offering, reorders them (the order becomes `display_order`),
 * and saves. Replaces the legacy single-product select; `forms.product_id` is
 * left untouched in the DB for back-compat.
 *
 * `products` is the full pool offered in the picker (active products, plus any
 * currently-offered product that has since been deactivated so the selection is
 * never silently lost). `initialSelectedIds` is the current offering order.
 */
type Props = {
  formId: string
  products: Product[]
  initialSelectedIds: string[]
}

export default function FormProductsPicker({
  formId,
  products,
  initialSelectedIds,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const byId = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  )

  // Products not yet in the offering, in the pool's natural order.
  const available = useMemo(
    () => products.filter((p) => !selectedIds.includes(p.id)),
    [products, selectedIds]
  )

  // Offering changed vs the last saved state → enable the Save button.
  const dirty = useMemo(() => {
    if (selectedIds.length !== initialSelectedIds.length) return true
    return selectedIds.some((id, i) => id !== initialSelectedIds[i])
  }, [selectedIds, initialSelectedIds])

  function add(id: string) {
    setSaved(false)
    setSelectedIds((ids) => (ids.includes(id) ? ids : [...ids, id]))
  }

  function remove(id: string) {
    setSaved(false)
    setSelectedIds((ids) => ids.filter((x) => x !== id))
  }

  function move(index: number, delta: -1 | 1) {
    setSaved(false)
    setSelectedIds((ids) => {
      const next = [...ids]
      const target = index + delta
      if (target < 0 || target >= next.length) return ids
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function handleSave() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result: ActionResult<void> = await setFormProducts(
        formId,
        selectedIds
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSaved(true)
      router.refresh()
    })
  }

  return (
    <div className="flex max-w-[640px] flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-dim">
          Offering ({selectedIds.length})
        </span>
        {selectedIds.length === 0 ? (
          <p className="rounded-[8px] border border-dashed border-line px-3.5 py-6 text-center text-sm text-dim">
            No products selected yet. Add at least one below before publishing.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {selectedIds.map((id, index) => {
              const product = byId.get(id)
              if (!product) return null
              return (
                <li
                  key={id}
                  className="flex items-center gap-3 rounded-[8px] border border-line bg-surface2 px-3.5 py-2.5"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate text-[15px] text-text">
                      {product.name}
                    </span>
                    {product.is_bundle ? (
                      <span className="shrink-0 rounded-full border border-accent/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-accent">
                        Bundle
                      </span>
                    ) : null}
                    {product.active === false ? (
                      <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-dim">
                        Inactive
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Move ${product.name} up`}
                      onClick={() => move(index, -1)}
                      disabled={index === 0 || isPending}
                      className="rounded-[6px] border border-line px-2 py-1 text-sm text-dim transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${product.name} down`}
                      onClick={() => move(index, 1)}
                      disabled={index === selectedIds.length - 1 || isPending}
                      className="rounded-[6px] border border-line px-2 py-1 text-sm text-dim transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(id)}
                      disabled={isPending}
                      className="rounded-[6px] border border-line px-2.5 py-1 text-sm font-medium text-dim transition-colors hover:text-red disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-dim">
          Available
        </span>
        {available.length === 0 ? (
          <p className="text-sm text-dim">All active products are offered.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {available.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  onClick={() => add(product.id)}
                  disabled={isPending}
                  className="flex items-center gap-2 rounded-[8px] border border-line px-3 py-2 text-sm text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span aria-hidden>+</span>
                  <span>{product.name}</span>
                  {product.is_bundle ? (
                    <span className="rounded-full border border-accent/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-accent">
                      Bundle
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red">
          {error}
        </p>
      ) : null}
      {saved && !dirty ? (
        <p className="text-sm text-dim">Offering saved.</p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending || !dirty}
          className="rounded-[8px] bg-accent px-4 py-2.5 text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Saving…' : 'Save offering'}
        </button>
      </div>
    </div>
  )
}
