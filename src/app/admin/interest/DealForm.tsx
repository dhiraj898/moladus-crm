'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type {
  CustomFieldDef,
  CustomFieldValues,
  Deal,
  Product,
} from '@/lib/supabase/types'
import { formatMoney } from '@/features/form-engine/estimate'
import type { GSTBreakdown } from '@/features/gst/compute'
import {
  createDeal,
  updateDeal,
  previewDealGST,
  type ActionResult,
} from '@/features/crm/deals/actions'
import CustomFieldInputs from '@/features/crm/custom-fields/CustomFieldInputs'

/**
 * Manual create / edit form for a single deal (spec §4.2 / §6).
 *
 * Picks a Contact + Product + place-of-supply and (on create) optionally mints a
 * Razorpay payment link. GST is NEVER computed here — the live preview is
 * fetched from the `previewDealGST` server action so the product's rate and the
 * business home state stay the single source of truth. Field-level Zod errors
 * surface inline; the submit is disabled while a request is in flight.
 */

export interface DealFormContact {
  id: string
  name: string | null
  whatsapp_number: string
}

export interface DealFormLead {
  id: string
  name: string | null
  phone: string | null
}

type Props =
  | {
      mode: 'create'
      products: Product[]
      contacts: DealFormContact[]
      leads: DealFormLead[]
      customFieldDefs: CustomFieldDef[]
      deal?: undefined
    }
  | {
      mode: 'edit'
      products: Product[]
      contacts: DealFormContact[]
      leads: DealFormLead[]
      customFieldDefs: CustomFieldDef[]
      deal: Deal
    }

const inputClass =
  'rounded-[8px] border border-line bg-surface2 px-3.5 py-2.5 text-[15px] text-text outline-none transition-colors focus:border-accent'

const labelClass = 'text-xs font-semibold uppercase tracking-[0.12em] text-dim'

/** Indian states + UTs for the place-of-supply select (GST §7). */
const INDIAN_STATES: readonly string[] = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
]

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null
  return (
    <span role="alert" className="text-xs text-red">
      {messages[0]}
    </span>
  )
}

export default function DealForm(props: Props) {
  const { mode, products, contacts, leads, customFieldDefs } = props
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  // Controlled state seeded from the existing deal on edit.
  const [contactId, setContactId] = useState(props.deal?.contact_id ?? '')
  const [leadId, setLeadId] = useState(props.deal?.lead_id ?? '')
  const [productId, setProductId] = useState(props.deal?.product_id ?? '')
  const [placeOfSupply, setPlaceOfSupply] = useState(
    props.deal?.place_of_supply ?? ''
  )
  const [createLink, setCreateLink] = useState(false)
  const [customFields, setCustomFields] = useState<CustomFieldValues>(
    props.deal?.custom_fields ?? {}
  )

  // Contact search filter (client-side over the passed list).
  const [contactQuery, setContactQuery] = useState('')

  // Live GST preview fetched from the server action.
  const [gst, setGst] = useState<GSTBreakdown | null>(null)
  const [pricing, setPricing] = useState(false)

  const selectedProduct = products.find((p) => p.id === productId) ?? null
  const currency = selectedProduct?.currency ?? 'INR'

  // Fetch the authoritative GST breakdown whenever product + state are set.
  useEffect(() => {
    if (!productId || !placeOfSupply) {
      setGst(null)
      return
    }
    let cancelled = false
    setPricing(true)
    previewDealGST(productId, placeOfSupply)
      .then((result) => {
        if (cancelled) return
        setGst(result.ok ? result.data : null)
      })
      .finally(() => {
        if (!cancelled) setPricing(false)
      })
    return () => {
      cancelled = true
    }
  }, [productId, placeOfSupply])

  const filteredContacts = contactQuery.trim()
    ? contacts.filter((c) => {
        const q = contactQuery.trim().toLowerCase()
        return (
          (c.name ?? '').toLowerCase().includes(q) ||
          c.whatsapp_number.toLowerCase().includes(q)
        )
      })
    : contacts

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setFieldErrors({})

    startTransition(async () => {
      if (mode === 'edit') {
        const result: ActionResult<void> = await updateDeal(props.deal.id, {
          contact_id: contactId,
          lead_id: leadId,
          product_id: productId,
          place_of_supply: placeOfSupply,
          custom_fields: customFields,
        })
        if (!result.ok) {
          setFormError(result.error)
          setFieldErrors(result.fieldErrors ?? {})
          return
        }
        router.push(`/admin/interest/${props.deal.id}`)
        router.refresh()
        return
      }

      const result: ActionResult<{ id: string }> = await createDeal({
        contact_id: contactId,
        lead_id: leadId,
        product_id: productId,
        place_of_supply: placeOfSupply,
        create_payment_link: createLink,
        custom_fields: customFields,
      })
      if (!result.ok) {
        setFormError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }
      if (result.warning) {
        // Surface the non-fatal link failure, then continue to the deal.
        window.alert(result.warning)
      }
      router.push(`/admin/interest/${result.data.id}`)
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-[640px] flex-col gap-5">
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Find contact</span>
        <input
          type="text"
          value={contactQuery}
          onChange={(e) => setContactQuery(e.target.value)}
          placeholder="Search by name or WhatsApp number…"
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Contact</span>
        <select
          required
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
          className={inputClass}
        >
          <option value="">Select a contact…</option>
          {filteredContacts.map((c) => (
            <option key={c.id} value={c.id}>
              {(c.name ?? 'Unnamed') + ' · ' + c.whatsapp_number}
            </option>
          ))}
        </select>
        <FieldError messages={fieldErrors.contact_id} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Linked lead (optional)</span>
        <select
          value={leadId}
          onChange={(e) => setLeadId(e.target.value)}
          className={inputClass}
        >
          <option value="">— None —</option>
          {leads.map((l) => (
            <option key={l.id} value={l.id}>
              {(l.name ?? 'Unnamed') + (l.phone ? ' · ' + l.phone : '')}
            </option>
          ))}
        </select>
        <FieldError messages={fieldErrors.lead_id} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Product</span>
        <select
          required
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          className={inputClass}
        >
          <option value="">Select a product…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <FieldError messages={fieldErrors.product_id} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Place of supply</span>
        <select
          required
          value={placeOfSupply}
          onChange={(e) => setPlaceOfSupply(e.target.value)}
          className={inputClass}
        >
          <option value="">Select a state…</option>
          {INDIAN_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <FieldError messages={fieldErrors.place_of_supply} />
      </label>

      <div className="rounded-[10px] border border-line bg-surface p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-dim">
          GST preview
        </h2>
        {!productId || !placeOfSupply ? (
          <p className="text-sm text-dim">
            Choose a product and place of supply to see the tax breakdown.
          </p>
        ) : pricing ? (
          <p className="text-sm text-dim">Calculating…</p>
        ) : gst ? (
          <dl className="flex flex-col">
            <PreviewRow label="Taxable amount" value={formatMoney(gst.taxableAmount, currency)} />
            <PreviewRow label="CGST" value={formatMoney(gst.cgst, currency)} />
            <PreviewRow label="SGST" value={formatMoney(gst.sgst, currency)} />
            <PreviewRow label="IGST" value={formatMoney(gst.igst, currency)} />
            <PreviewRow label="Total" value={formatMoney(gst.total, currency)} strong />
          </dl>
        ) : (
          <p className="text-sm text-dim">Could not price this deal.</p>
        )}
      </div>

      {mode === 'create' ? (
        <label className="flex items-center justify-between gap-4 rounded-[10px] border border-line bg-surface p-4">
          <span className="flex flex-col">
            <span className="text-sm font-medium text-text">
              Create payment link now
            </span>
            <span className="text-xs text-dim">
              Mints a Razorpay link for the total and marks the deal “link sent”.
            </span>
          </span>
          <input
            type="checkbox"
            checked={createLink}
            onChange={(e) => setCreateLink(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
        </label>
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
              : 'Create deal'}
        </button>
        <button
          type="button"
          onClick={() =>
            router.push(
              mode === 'edit' ? `/admin/interest/${props.deal.id}` : '/admin/interest'
            )
          }
          className="rounded-[8px] border border-line px-4 py-2.5 text-[15px] font-medium text-dim transition-colors hover:text-text"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

function PreviewRow({
  label,
  value,
  strong = false,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2 last:border-b-0">
      <dt className="text-sm text-dim">{label}</dt>
      <dd
        className={[
          'text-right text-sm tabular-nums text-text',
          strong ? 'font-semibold' : 'font-medium',
        ].join(' ')}
      >
        {value}
      </dd>
    </div>
  )
}
