'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type {
  CustomFieldDef,
  CustomFieldValues,
  Lead,
  Product,
} from '@/lib/supabase/types'
import {
  createLead,
  updateLead,
  type ActionResult,
} from '@/features/crm/leads/actions'
import { LEAD_STATUSES } from '@/features/crm/leads/schema'
import CustomFieldInputs from '@/features/crm/custom-fields/CustomFieldInputs'

/**
 * Manual create / edit form for a single lead (spec §6). A thin hand-entered
 * record — name, contact details, source and workflow status, plus an optional
 * product link. Field-level Zod errors surface inline; submit is disabled while
 * a request is in flight.
 */

type Props =
  | {
      mode: 'create'
      products: Product[]
      customFieldDefs: CustomFieldDef[]
      lead?: undefined
    }
  | {
      mode: 'edit'
      products: Product[]
      customFieldDefs: CustomFieldDef[]
      lead: Lead
    }

const inputClass =
  'rounded-[8px] border border-line bg-surface2 px-3.5 py-2.5 text-[15px] text-text outline-none transition-colors focus:border-accent'

const labelClass = 'text-xs font-semibold uppercase tracking-[0.12em] text-dim'

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null
  return (
    <span role="alert" className="text-xs text-red">
      {messages[0]}
    </span>
  )
}

export default function LeadForm(props: Props) {
  const { mode, products, customFieldDefs } = props
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  const [name, setName] = useState(props.lead?.name ?? '')
  const [email, setEmail] = useState(props.lead?.email ?? '')
  const [phone, setPhone] = useState(props.lead?.phone ?? '')
  const [state, setState] = useState(props.lead?.state ?? '')
  const [source, setSource] = useState(props.lead?.source ?? '')
  const [status, setStatus] = useState(props.lead?.status ?? 'new')
  const [productId, setProductId] = useState(props.lead?.product_id ?? '')
  const [customFields, setCustomFields] = useState<CustomFieldValues>(
    props.lead?.custom_fields ?? {}
  )

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setFieldErrors({})

    const payload = {
      name,
      email,
      phone,
      state,
      source,
      status: status as (typeof LEAD_STATUSES)[number],
      product_id: productId,
      custom_fields: customFields,
    }

    startTransition(async () => {
      if (mode === 'edit') {
        const result: ActionResult<void> = await updateLead(
          props.lead.id,
          payload
        )
        if (!result.ok) {
          setFormError(result.error)
          setFieldErrors(result.fieldErrors ?? {})
          return
        }
        router.push(`/admin/leads/${props.lead.id}`)
        router.refresh()
        return
      }

      const result: ActionResult<{ id: string }> = await createLead(payload)
      if (!result.ok) {
        setFormError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }
      router.push(`/admin/leads/${result.data.id}`)
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-[640px] flex-col gap-5">
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          className={inputClass}
        />
        <FieldError messages={fieldErrors.name} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Email</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          className={inputClass}
        />
        <FieldError messages={fieldErrors.email} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Phone</span>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+91…"
          className={inputClass}
        />
        <FieldError messages={fieldErrors.phone} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>State</span>
        <input
          type="text"
          value={state}
          onChange={(e) => setState(e.target.value)}
          placeholder="e.g. Maharashtra"
          className={inputClass}
        />
        <FieldError messages={fieldErrors.state} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Source</span>
        <input
          type="text"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="e.g. Referral, Instagram"
          className={inputClass}
        />
        <FieldError messages={fieldErrors.source} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Status</span>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={inputClass}
        >
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
        <FieldError messages={fieldErrors.status} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Product (optional)</span>
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          className={inputClass}
        >
          <option value="">— None —</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <FieldError messages={fieldErrors.product_id} />
      </label>

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
              : 'Create lead'}
        </button>
        <button
          type="button"
          onClick={() =>
            router.push(
              mode === 'edit' ? `/admin/leads/${props.lead.id}` : '/admin/leads'
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
