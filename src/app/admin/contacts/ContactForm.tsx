'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type {
  Contact,
  CustomFieldDef,
  CustomFieldValues,
} from '@/lib/supabase/types'
import {
  createContact,
  updateContact,
  type ActionResult,
} from '@/features/crm/contacts/actions'
import CustomFieldInputs from '@/features/crm/custom-fields/CustomFieldInputs'

/**
 * Manual create / edit form for a single contact (spec §6). `whatsapp_number`
 * is required and unique — a duplicate maps to an inline field error. Optional
 * linked lead + comma-separated tags. Field-level Zod errors surface inline;
 * submit is disabled while a request is in flight.
 */

export interface ContactFormLead {
  id: string
  name: string | null
  phone: string | null
}

type Props =
  | {
      mode: 'create'
      leads: ContactFormLead[]
      customFieldDefs: CustomFieldDef[]
      contact?: undefined
    }
  | {
      mode: 'edit'
      leads: ContactFormLead[]
      customFieldDefs: CustomFieldDef[]
      contact: Contact
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

/** Split a comma-separated tag string into a trimmed, de-duplicated array. */
function parseTags(raw: string): string[] {
  const seen = new Set<string>()
  for (const part of raw.split(',')) {
    const tag = part.trim()
    if (tag) seen.add(tag)
  }
  return Array.from(seen)
}

export default function ContactForm(props: Props) {
  const { mode, leads, customFieldDefs } = props
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  const [name, setName] = useState(props.contact?.name ?? '')
  const [email, setEmail] = useState(props.contact?.email ?? '')
  const [whatsapp, setWhatsapp] = useState(props.contact?.whatsapp_number ?? '')
  const [consent, setConsent] = useState(
    props.contact?.marketing_consent ?? false
  )
  const [leadId, setLeadId] = useState(props.contact?.lead_id ?? '')
  const [tags, setTags] = useState((props.contact?.tags ?? []).join(', '))
  const [customFields, setCustomFields] = useState<CustomFieldValues>(
    props.contact?.custom_fields ?? {}
  )

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setFieldErrors({})

    const payload = {
      name,
      email,
      whatsapp_number: whatsapp,
      marketing_consent: consent,
      lead_id: leadId,
      tags: parseTags(tags),
      custom_fields: customFields,
    }

    startTransition(async () => {
      if (mode === 'edit') {
        const result: ActionResult<void> = await updateContact(
          props.contact.id,
          payload
        )
        if (!result.ok) {
          setFormError(result.error)
          setFieldErrors(result.fieldErrors ?? {})
          return
        }
        router.push(`/admin/contacts/${props.contact.id}`)
        router.refresh()
        return
      }

      const result: ActionResult<{ id: string }> = await createContact(payload)
      if (!result.ok) {
        setFormError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }
      router.push(`/admin/contacts/${result.data.id}`)
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
        <span className={labelClass}>WhatsApp number</span>
        <input
          type="tel"
          required
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          placeholder="+91…"
          className={inputClass}
        />
        <FieldError messages={fieldErrors.whatsapp_number} />
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
        <span className={labelClass}>Tags</span>
        <input
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="Comma-separated, e.g. VIP, Referral"
          className={inputClass}
        />
        <FieldError messages={fieldErrors.tags} />
      </label>

      <label className="flex items-center justify-between gap-4 rounded-[10px] border border-line bg-surface p-4">
        <span className="flex flex-col">
          <span className="text-sm font-medium text-text">
            Marketing consent
          </span>
          <span className="text-xs text-dim">
            Records the opt-in timestamp when enabled.
          </span>
        </span>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="h-4 w-4 accent-accent"
        />
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
              : 'Create contact'}
        </button>
        <button
          type="button"
          onClick={() =>
            router.push(
              mode === 'edit'
                ? `/admin/contacts/${props.contact.id}`
                : '/admin/contacts'
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
